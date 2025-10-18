import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import pLimit = require('p-limit');
type LimitFunction = ReturnType<typeof pLimit>;
import { CacheService } from '../cache/cache.service';
import { MetricsService } from '../observability/metrics/metrics.service';
import { CoingeckoProvider } from './providers/coingecko.provider';
import { MoralisProvider } from './providers/moralis.provider';
import { PortalsProvider } from './providers/portals.provider';
import { OneInchProvider } from './providers/1inch.provider';
import { DeFiLlamaProvider } from './providers/defillama.provider';
import {
  IProvider,
  TokenRequest,
  ProviderResponse,
  BatchProviderResponse,
  TokenPrice,
} from './providers/provider.interface';
import { OutlierFilter } from './utils/outlier-filter';
import { PriceAggregator } from './utils/aggregator';
import { QuorumChecker } from './utils/quorum';
import { TokenDto } from './dto/token.dto';
import { TokenPriceDto } from './dto/price-response.dto';
import { CircuitBreakerFactory } from './resilience/circuit-breaker';
import { RateLimiterFactory } from './resilience/rate-limiter';
import { RetryPolicyFactory } from './resilience/retry.policy';
import { ProviderPolicies } from './resilience/resilience.interface';

@Injectable()
export class PricesService {
  private readonly logger = new Logger(PricesService.name);
  private readonly providers: IProvider[];
  private readonly providerPolicies: Map<string, ProviderPolicies> = new Map();
  private readonly hardTimeout: number;
  private readonly requiredQuorum: number;
  private readonly outlierThreshold: number;
  private readonly outlierK: number;
  private readonly parallelLimit: LimitFunction;

  constructor(
    private readonly cacheService: CacheService,
    private readonly metricsService: MetricsService,
    private readonly configService: ConfigService,
    private readonly coingeckoProvider: CoingeckoProvider,
    private readonly moralisProvider: MoralisProvider,
    private readonly portalsProvider: PortalsProvider,
    private readonly oneInchProvider: OneInchProvider,
    private readonly defillamaProvider: DeFiLlamaProvider,
  ) {
    this.providers = [
      this.coingeckoProvider,
      this.moralisProvider,
      this.portalsProvider,
      this.oneInchProvider,
      this.defillamaProvider,
    ];

    this.hardTimeout = this.configService.get<number>(
      'PROVIDERS_HARD_TIMEOUT_MS',
      1500,
    );
    this.requiredQuorum = this.configService.get<number>('PROVIDERS_QUORUM', 5);
    this.outlierThreshold = this.configService.get<number>(
      'OUTLIER_REL_THRESHOLD',
      0.1,
    );
    this.outlierK = this.configService.get<number>('OUTLIER_K', 3.5);

    const parallelTokens = parseInt(
      this.configService.get<string>('PARALLEL_TOKENS', '50'),
      10,
    );
    this.parallelLimit = pLimit(parallelTokens);

    this.initializeProviderPolicies();
  }

  private initializeProviderPolicies() {
    for (const provider of this.providers) {
      const circuitBreaker = CircuitBreakerFactory.create(provider.name);

      // Get provider-specific rate limit from config or use default
      let rateLimitRps = 10; // default 10 RPS

      if (provider.name === 'Coingecko') {
        rateLimitRps = parseFloat(
          this.configService.get('COINGECKO_RATE_LIMIT', '15.0'),
        );
      } else if (provider.name === 'Moralis') {
        rateLimitRps = parseFloat(
          this.configService.get('MORALIS_RATE_LIMIT', '3.0'),
        );
      } else if (provider.name === 'portals') {
        rateLimitRps = parseFloat(
          this.configService.get('PORTALS_RATE_LIMIT', '8.0'),
        );
      } else if (provider.name === '1inch') {
        rateLimitRps = parseFloat(
          this.configService.get('ONEINCH_RATE_LIMIT', '15.0'),
        );
      } else if (provider.name === 'defillama') {
        rateLimitRps = parseFloat(
          this.configService.get('DEFILLAMA_RATE_LIMIT', '20.0'),
        );
      }

      const minTime = Math.floor(1000 / rateLimitRps); // Convert RPS to ms between requests
      const reservoir = Math.ceil(rateLimitRps * 60); // Burst capacity: 1 minute worth

      this.logger.log(
        `Rate limiter for ${provider.name}: ${rateLimitRps} RPS (${minTime}ms between requests, burst: ${reservoir})`,
      );

      const rateLimiter = RateLimiterFactory.create(provider.name, {
        minTime,
        reservoir,
        reservoirRefreshAmount: reservoir,
        reservoirRefreshInterval: 60 * 1000, // Refresh every minute
      });

      const retryPolicy = RetryPolicyFactory.create(provider.name);

      this.providerPolicies.set(provider.name, {
        circuitBreaker,
        rateLimiter,
        retryPolicy,
      });
    }
  }

  async getPrices(tokens: TokenDto[]): Promise<TokenPriceDto[]> {
    this.logger.log(`Fetching prices for ${tokens.length} tokens`);

    // Check cache first for each token
    const cachedResults: TokenPriceDto[] = [];
    const uncachedTokens: TokenDto[] = [];

    this.logger.log(`Starting cache check for ${tokens.length} tokens`);

    for (const token of tokens) {
      const cacheKey = `pp:v1:${token.chainId}:${token.address.toLowerCase()}`;
      this.logger.log(`Checking cache for key: ${cacheKey}`);
      
      const cached = await this.cacheService.get<TokenPriceDto>(cacheKey);
      
      if (cached) {
        cachedResults.push(cached);
        this.metricsService.recordCacheHit('redis');
        this.logger.log(`Cache hit for ${token.address}`);
      } else {
        uncachedTokens.push(token);
        this.logger.log(`Cache miss for ${token.address}`);
      }
    }

    this.logger.log(`Cache check complete: ${cachedResults.length} cached, ${uncachedTokens.length} uncached`);

    // If all tokens are cached, return cached results
    if (uncachedTokens.length === 0) {
      this.logger.log(`All ${tokens.length} tokens served from cache`);
      return cachedResults;
    }

    this.logger.log(`Fetching ${uncachedTokens.length} uncached tokens from providers`);

    // Hybrid approach: batch for Portals, parallel for others
    const providerPromises: Promise<
      ProviderResponse | BatchProviderResponse
    >[] = [];

    // Portals.fi + 1inch + DeFiLlama - use batch requests (supports multiple tokens)
    const batchProviders = this.providers.filter((p) => p.name === 'portals' || p.name === '1inch' || p.name === 'defillama');
    batchProviders.forEach((provider) => {
      providerPromises.push(
        this.parallelLimit(() =>
          this.fetchBatchFromProvider(provider, uncachedTokens),
        ),
      );
    });

    // CoinGecko + Moralis - use parallel requests (no batch support)
    const otherProviders = this.providers.filter((p) => p.name !== 'portals' && p.name !== '1inch' && p.name !== 'defillama');
    otherProviders.forEach((provider) => {
      uncachedTokens.forEach((token) => {
        providerPromises.push(
          this.parallelLimit(() =>
            this.fetchSingleTokenFromProvider(provider, token),
          ),
        );
      });
    });

    const results = await Promise.allSettled(providerPromises);

    // Aggregate results using hybrid logic
    const aggregatedResults = this.aggregateHybridResults(uncachedTokens, results);

    // Cache the new results
    for (const result of aggregatedResults) {
      if (!result.error) {
        const cacheKey = `pp:v1:${result.chainId}:${result.address.toLowerCase()}`;
        await this.cacheService.set(cacheKey, result, { 
          ttl: this.configService.get<number>('CACHE_TTL_SECONDS', 2) 
        });
        this.logger.log(`Cached result for ${result.address}`);
      }
    }

    // Combine cached and fresh results
    const finalResults = [...cachedResults, ...aggregatedResults];
    this.logger.log(`Final response: ${finalResults.length} tokens (${finalResults.filter((t) => !t.error).length} successful)`);
    return finalResults;
  }

  private async fetchBatchFromProvider(
    provider: IProvider,
    tokens: TokenDto[],
  ): Promise<any> {
    const startTime = Date.now();

    try {
      this.logger.log(`Starting batch request to ${provider.name} for ${tokens.length} tokens`);
      const result = await provider.getPrices(tokens);
      const latency = Date.now() - startTime;

      this.logger.log(`${provider.name} batch result: success=${result.success}, prices=${result.prices?.length || 0}, errors=${result.errors?.length || 0} (${latency}ms)`);

      // Record metrics
      this.metricsService.recordProviderCall(
        provider.name,
        result.success ? 'success' : 'error',
      );
      this.metricsService.recordProviderLatency(provider.name, latency / 1000);

      if (result.isRateLimitError) {
        this.metricsService.recordRateLimitError(provider.name);
      }

      return result;
    } catch (error) {
      const latency = Date.now() - startTime;
      this.logger.error(
        `Batch error from ${provider.name}: ${error.message} (${latency}ms)`,
      );
      this.metricsService.recordProviderCall(provider.name, 'error');
      this.metricsService.recordProviderLatency(provider.name, latency / 1000);
      throw error;
    }
  }

  private async fetchSingleTokenFromProvider(
    provider: IProvider,
    token: TokenDto,
  ): Promise<any> {
    const startTime = Date.now();

    try {
      const result = await provider.getPrice(token);
      const latency = Date.now() - startTime;

      // Record metrics
      this.metricsService.recordProviderCall(
        provider.name,
        result.success ? 'success' : 'error',
      );
      this.metricsService.recordProviderLatency(provider.name, latency / 1000);

      if (result.isRateLimitError) {
        this.metricsService.recordRateLimitError(provider.name);
      }

      return result;
    } catch (error) {
      const latency = Date.now() - startTime;
      this.logger.error(
        `Single error from ${provider.name}: ${error.message} (${latency}ms)`,
      );
      this.metricsService.recordProviderCall(provider.name, 'error');
      this.metricsService.recordProviderLatency(provider.name, latency / 1000);
      throw error;
    }
  }

  private aggregateHybridResults(
    tokens: TokenDto[],
    results: PromiseSettledResult<ProviderResponse | BatchProviderResponse>[],
  ): TokenPriceDto[] {
    const responseTokens: TokenPriceDto[] = [];

    // Create a map of token results
    const tokenResults = new Map<
      string,
      { prices: number[]; errors: string[]; metadata?: TokenPrice }
    >();

    tokens.forEach((token) => {
      const key = `${token.chainId}:${token.address.toLowerCase()}`;
      tokenResults.set(key, { prices: [], errors: [] });
    });

    let resultIndex = 0;

    // Process Portals batch result (first result)
    const portalsProvider = this.providers.find((p) => p.name === 'portals');
    if (portalsProvider && resultIndex < results.length) {
      const portalsResult = results[resultIndex];
      this.logger.log(
        `Processing Portals result ${resultIndex}: status=${portalsResult.status}`,
      );

      if (portalsResult.status === 'fulfilled' && portalsResult.value.success) {
        const providerResult = portalsResult.value as BatchProviderResponse;
        this.logger.log(
          `Portals batch: ${providerResult.prices?.length || 0} prices, ${providerResult.errors?.length || 0} errors`,
        );

        // Add successful prices from Portals batch
        providerResult.prices.forEach((price: TokenPrice) => {
          const key = `${price.chainId}:${price.address.toLowerCase()}`;
          const tokenResult = tokenResults.get(key);
          if (tokenResult) {
            tokenResult.prices.push(price.price);
            
            // Update metadata if we don't have it, or if current metadata lacks logo but new one has it
            if (!tokenResult.metadata || 
                (!tokenResult.metadata.logo && price.logo)) {
              tokenResult.metadata = price;
            }
            
            this.logger.log(`Added Portals price for ${key}: $${price.price}`);
          } else {
            this.logger.log(`No token result found for Portals price ${key}`);
          }
        });

        // Add errors from Portals batch
        providerResult.errors.forEach(
          (error: { chainId: number; address: string; error: string }) => {
            const key = `${error.chainId}:${error.address.toLowerCase()}`;
            const tokenResult = tokenResults.get(key);
            if (tokenResult) {
              tokenResult.errors.push(error.error);
            }
          },
        );
      }
      resultIndex++;
    }

    // Process individual token results from other providers
    const otherProviders = this.providers.filter((p) => p.name !== 'portals');

    // Process results in order, finding matching tokens
    otherProviders.forEach((provider) => {
      tokens.forEach((_token) => {
        if (resultIndex < results.length) {
          const result = results[resultIndex];
          this.logger.log(
            `Processing ${provider.name} result ${resultIndex}: status=${result.status}`,
          );

          if (result.status === 'fulfilled' && result.value.success) {
            const providerResponse = result.value as ProviderResponse;
            this.logger.log(
              `${provider.name} result: success=${providerResponse.success}, price=${providerResponse.price}`,
            );

            // ProviderResponse.price is a TokenPrice object
            if (providerResponse.price) {
              const resultKey = `${providerResponse.price.chainId}:${providerResponse.price.address.toLowerCase()}`;
              const tokenData = tokenResults.get(resultKey);
              if (tokenData) {
                tokenData.prices.push(providerResponse.price.price); // Extract the actual price number
                
                // Update metadata if we don't have it, or if current metadata lacks logo but new one has it
                if (!tokenData.metadata || 
                    (!tokenData.metadata.logo && providerResponse.price.logo)) {
                  tokenData.metadata = providerResponse.price;
                }
                
                this.logger.log(
                  `Added ${provider.name} price for ${resultKey}: $${providerResponse.price.price}`,
                );
              } else {
                this.logger.log(`No token data found for ${resultKey}`);
              }
            }
          }
          resultIndex++;
        }
      });
    });

    // Build final response
    tokens.forEach((token) => {
      const key = `${token.chainId}:${token.address.toLowerCase()}`;
      const tokenResult = tokenResults.get(key);

      this.logger.log(
        `Final aggregation for ${key}: prices=${tokenResult?.prices.length || 0}, quorum=${this.requiredQuorum}`,
      );

      if (tokenResult && tokenResult.prices.length >= this.requiredQuorum) {
        this.logger.log(
          `Prices for ${key}: [${tokenResult.prices.join(', ')}]`,
        );

        // Apply outlier filtering
        const { valid } = OutlierFilter.filter(
          tokenResult.prices.map((price) => ({ price, source: 'hybrid' })),
          { relativeThreshold: this.outlierThreshold, kFactor: this.outlierK },
        );

        this.logger.log(
          `After outlier filtering for ${key}: valid=${valid.length}, required=${this.requiredQuorum}`,
        );

        if (valid.length >= this.requiredQuorum) {
          // Calculate median price
          const sortedPrices = valid.map((v) => v.price).sort((a, b) => a - b);
          const medianPrice = sortedPrices[Math.floor(sortedPrices.length / 2)];

          this.logger.log(`Success for ${key}: median=$${medianPrice}`);

          // Record quorum metric
          this.metricsService.recordQuorum(valid.length);

          responseTokens.push({
            chainId: token.chainId,
            address: token.address,
            name: tokenResult.metadata?.name || 'Unknown',
            symbol: tokenResult.metadata?.symbol || 'UNKNOWN',
            logo: tokenResult.metadata?.logo,
            decimals: tokenResult.metadata?.decimals || 18,
            price: medianPrice,
            timestamp: Date.now(),
          });
        } else {
          this.logger.log(
            `Insufficient valid prices for ${key}: ${valid.length} < ${this.requiredQuorum}`,
          );
          responseTokens.push({
            chainId: token.chainId,
            address: token.address,
            error: 'Insufficient valid price data',
          });
        }
      } else {
        this.logger.log(
          `Insufficient prices for ${key}: ${tokenResult?.prices.length || 0} < ${this.requiredQuorum}`,
        );
        responseTokens.push({
          chainId: token.chainId,
          address: token.address,
          error: 'Insufficient price data',
        });
      }
    });

    this.logger.log(
      `Final response: ${responseTokens.length} tokens (${responseTokens.filter((t) => !t.error).length} successful)`,
    );
    return responseTokens;
  }

  private async getPriceForToken(
    token: TokenDto,
  ): Promise<{ success: boolean; data?: TokenPriceDto; error?: string }> {
    // Validate chainId
    const supportedChains = [1, 56, 137, 43114, 250, 42161, 10, 8453]; // Ethereum, BSC, Polygon, Avalanche, Fantom, Arbitrum, Optimism, Base
    if (!supportedChains.includes(token.chainId)) {
      return {
        success: false,
        error: 'Unsupported chain',
      };
    }

    // Validate address format
    if (!/^0x[a-fA-F0-9]{40}$/.test(token.address)) {
      return {
        success: false,
        error: 'Invalid contract address',
      };
    }

    const cacheKey = `pp:v1:${token.chainId}:${token.address.toLowerCase()}`;

    try {
      // Use singleflight pattern to prevent thundering herd
      const result = await this.cacheService.singleflight(
        cacheKey,
        () => this.fetchAndAggregatePriceForToken(token),
        { ttl: this.configService.get<number>('CACHE_TTL_SECONDS', 2) },
      );

      if (result.fromCache) {
        this.logger.debug(
          `Cache hit for ${token.address} (wait: ${result.waitTime || 0}ms)`,
        );
        // Record cache hit metric (redis for cached data)
        this.metricsService.recordCacheHit('redis');

        // Record singleflight wait time if applicable
        if (result.waitTime && result.waitTime > 0) {
          this.metricsService.recordSingleflightWait(result.waitTime / 1000);
        }
      }

      if (result.value === null) {
        return {
          success: false,
          error: 'Failed to fetch price: insufficient data from providers',
        };
      }

      return { success: true, data: result.value };
    } catch (error) {
      this.logger.error(
        `Failed to get price for ${token.address}: ${error.message}`,
      );
      return {
        success: false,
        error: error.message || 'Unknown error',
      };
    }
  }

  private async fetchAndAggregatePriceForToken(
    token: TokenDto,
  ): Promise<TokenPriceDto | null> {
    const startTime = Date.now();

    // Fetch prices from all providers in parallel
    const providerPromises = this.providers.map((provider) =>
      this.fetchFromProvider(provider, token),
    );

    // Wait for all providers with hard timeout
    const settledResults = await Promise.race([
      Promise.allSettled(providerPromises),
      this.createTimeoutPromise(this.hardTimeout),
    ]);

    const elapsed = Date.now() - startTime;

    // Extract successful responses
    const successfulPrices = settledResults
      .map((result, index) => ({
        result,
        provider: this.providers[index],
      }))
      .filter(
        ({ result }) => result.status === 'fulfilled' && result.value.success,
      )
      .map(({ result, provider }) => ({
        price: (result as PromiseFulfilledResult<any>).value.price,
        source: provider.name.toLowerCase(),
      }));

    this.logger.log(
      `Received ${successfulPrices.length}/${this.providers.length} successful responses in ${elapsed}ms`,
    );

    // Check quorum
    if (
      !QuorumChecker.hasQuorum(
        successfulPrices.length,
        this.providers.length,
        this.requiredQuorum,
      )
    ) {
      this.logger.warn(
        `Insufficient data for ${token.address}: ${successfulPrices.length}/${this.requiredQuorum} required`,
      );
      return null;
    }

    // Filter outliers
    const priceData = successfulPrices.map((p) => ({
      price: p.price.price,
      source: p.source,
    }));

    const { valid, outliers } = OutlierFilter.filter(priceData, {
      relativeThreshold: this.outlierThreshold,
      kFactor: this.outlierK,
    });

    // Record outlier metrics
    outliers.forEach((outlier) => {
      this.metricsService.recordOutlier(outlier.source);
      this.logger.debug(
        `Outlier detected from ${outlier.source}: $${outlier.price}`,
      );
    });

    if (valid.length < this.requiredQuorum) {
      this.logger.warn(
        `After filtering outliers, insufficient valid prices: ${valid.length}/${this.requiredQuorum}`,
      );
      return null;
    }

    // Record quorum metric
    this.metricsService.recordQuorum(valid.length);

    // Aggregate valid prices
    const validPricesWithMetadata = valid.map((v) => {
      const original = successfulPrices.find((p) => p.source === v.source);
      return {
        price: original!.price,
        source: original!.source,
      };
    });

    const aggregated = PriceAggregator.aggregate(validPricesWithMetadata);

    if (!aggregated) {
      return null;
    }

    // Build response (no sources field as per spec)
    return {
      chainId: token.chainId,
      address: token.address.toLowerCase(),
      name: aggregated.metadata.name,
      symbol: aggregated.metadata.symbol,
      logo: aggregated.metadata.logo,
      decimals: aggregated.metadata.decimals,
      price: aggregated.price,
      timestamp: aggregated.timestamp,
    };
  }

  private async fetchFromProvider(
    provider: IProvider,
    token: TokenRequest,
  ): Promise<any> {
    const startTime = Date.now();
    const policies = this.providerPolicies.get(provider.name);

    try {
      let result;
      if (!policies) {
        result = await provider.getPrice(token);
      } else {
        // Apply circuit breaker, rate limiter, and retry policy
        result = await policies.circuitBreaker.execute(async () => {
          return policies.rateLimiter.schedule(() => {
            return policies.retryPolicy.execute(() => provider.getPrice(token));
          });
        });
      }

      const latency = (Date.now() - startTime) / 1000;

      // Record metrics
      if (result.success) {
        this.metricsService.recordProviderCall(provider.name, 'success');
        this.metricsService.recordProviderLatency(provider.name, latency);
      } else {
        this.metricsService.recordProviderCall(provider.name, 'error');

        // Record rate limit errors specifically
        if (result.isRateLimitError) {
          this.metricsService.recordRateLimitError(provider.name);
          this.logger.warn(
            `Rate limit error (429) from ${provider.name} for ${token.address}`,
          );
        }
      }

      return result;
    } catch (error) {
      const latency = (Date.now() - startTime) / 1000;
      this.metricsService.recordProviderCall(provider.name, 'error');
      this.metricsService.recordProviderLatency(provider.name, latency);
      throw error;
    }
  }

  private createTimeoutPromise(ms: number): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => {
        this.logger.warn(`Hard timeout reached (${ms}ms)`);
        reject(new Error(`Hard timeout reached (${ms}ms)`));
      }, ms);
    });
  }

  async healthCheck(): Promise<{
    healthy: boolean;
    providers: Record<string, boolean>;
    cache: boolean;
  }> {
    const providerHealths = await Promise.all(
      this.providers.map(async (provider) => ({
        name: provider.name.toLowerCase(),
        healthy: await provider.healthCheck().catch((error) => {
          this.logger.debug(
            `Health check failed for ${provider.name}: ${error.message}`,
          );
          return false;
        }),
      })),
    );

    const providersStatus = providerHealths.reduce(
      (acc, { name, healthy }) => {
        acc[name] = healthy;
        return acc;
      },
      {} as Record<string, boolean>,
    );

    const cacheHealthy = await this.cacheService.healthCheck();

    const overallHealthy =
      cacheHealthy && providerHealths.some((p) => p.healthy);

    return {
      healthy: overallHealthy,
      providers: providersStatus,
      cache: cacheHealthy,
    };
  }
}
