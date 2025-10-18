import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BaseProvider } from './base.provider';
import {
  TokenRequest,
  ProviderResponse,
  BatchProviderResponse,
  TokenPrice,
} from './provider.interface';

@Injectable()
export class CoingeckoProvider extends BaseProvider {
  private readonly apiKey?: string;
  private readonly baseUrl: string;

  // Chain ID to CoinGecko platform mapping
  private readonly chainPlatforms: Record<number, string> = {
    1: 'ethereum',
    56: 'binance-smart-chain',
    137: 'polygon-pos',
    250: 'fantom',
    43114: 'avalanche',
    42161: 'arbitrum-one',
    10: 'optimistic-ethereum',
    8453: 'base',
  };

  constructor(private configService: ConfigService) {
    super('Coingecko', configService.get<number>('PROVIDERS_TIMEOUT_MS', 900));
    this.apiKey = configService.get<string>('COINGECKO_API_KEY');
    // Always use public API URL (works for both free and demo keys)
    this.baseUrl = 'https://api.coingecko.com/api/v3';
  }

  async getPrice(token: TokenRequest): Promise<ProviderResponse> {
    const startTime = Date.now();

    try {
      const platform = this.chainPlatforms[token.chainId];
      if (!platform) {
        throw new Error(`Unsupported chain ID: ${token.chainId}`);
      }

      // Get token info and price
      // Add API key as query parameter if available
      const apiKeyParam = this.apiKey
        ? `?x_cg_demo_api_key=${this.apiKey}`
        : '';
      const url = `${this.baseUrl}/coins/${platform}/contract/${token.address.toLowerCase()}${apiKeyParam}`;
      const data = await this.makeRequest<any>(url);

      const latency = Date.now() - startTime;

      if (!data.market_data?.current_price?.usd) {
        throw new Error('Price data not available');
      }

      this.logger.log(
        `Price fetched: ${data.symbol?.toUpperCase()} = $${data.market_data.current_price.usd} (${latency}ms)`,
      );

      return this.createSuccessResponse(
        data.market_data.current_price.usd,
        token,
        {
          name: data.name,
          symbol: data.symbol?.toUpperCase(),
          logo: data.image?.large || data.image?.small,
          decimals: data.detail_platforms?.[platform]?.decimal_place,
        },
        latency,
      );
    } catch (error) {
      const latency = Date.now() - startTime;
      this.logger.error(
        `Failed to fetch price for ${token.address}: ${error.message}`,
      );
      return this.createErrorResponse(error, latency);
    }
  }

  async getPrices(tokens: TokenRequest[]): Promise<BatchProviderResponse> {
    const startTime = Date.now();

    try {
      // Group tokens by chainId
      const tokensByChain = tokens.reduce(
        (acc, token) => {
          if (!acc[token.chainId]) {
            acc[token.chainId] = [];
          }
          acc[token.chainId].push(token);
          return acc;
        },
        {} as Record<number, TokenRequest[]>,
      );

      const allPrices: TokenPrice[] = [];
      const allErrors: { chainId: number; address: string; error: string }[] =
        [];

      // Process each chain separately
      for (const [chainId, chainTokens] of Object.entries(tokensByChain)) {
        const platform = this.chainPlatforms[parseInt(chainId)];
        if (!platform) {
          // Add error for unsupported chain
          chainTokens.forEach((token) => {
            allErrors.push({
              chainId: token.chainId,
              address: token.address,
              error: 'Unsupported chain',
            });
          });
          continue;
        }

        // Build contract addresses list
        const contractAddresses = chainTokens
          .map((token) => token.address.toLowerCase())
          .join(',');

        const apiKeyParam = this.apiKey
          ? `&x_cg_demo_api_key=${this.apiKey}`
          : '';

        const url = `${this.baseUrl}/simple/token_price/${platform}?contract_addresses=${contractAddresses}&vs_currencies=usd&include_24hr_change=false&include_last_updated_at=true${apiKeyParam}`;

        try {
          const data = await this.makeRequest<Record<string, any>>(url);

          // Process results
          chainTokens.forEach((token) => {
            const tokenData = data[token.address.toLowerCase()];
            if (tokenData && tokenData.usd) {
              allPrices.push({
                chainId: token.chainId,
                address: token.address.toLowerCase(),
                name: tokenData.name || 'Unknown',
                symbol: tokenData.symbol || 'UNKNOWN',
                decimals: 18, // Default, CoinGecko doesn't provide decimals
                price: tokenData.usd,
                timestamp: tokenData.last_updated_at
                  ? tokenData.last_updated_at * 1000
                  : Date.now(),
              });
            } else {
              allErrors.push({
                chainId: token.chainId,
                address: token.address,
                error: 'Token not found',
              });
            }
          });
        } catch (error) {
          // Add error for all tokens in this chain
          chainTokens.forEach((token) => {
            allErrors.push({
              chainId: token.chainId,
              address: token.address,
              error: error.message || 'Provider error',
            });
          });
        }
      }

      const latency = Date.now() - startTime;
      this.logger.debug(
        `Batch price fetch completed: ${allPrices.length} prices, ${allErrors.length} errors (${latency}ms)`,
      );

      return {
        success: allPrices.length > 0,
        prices: allPrices,
        errors: allErrors,
        latency,
      };
    } catch (error) {
      const latency = Date.now() - startTime;
      this.logger.error(`Batch price fetch failed: ${error.message}`);
      return {
        success: false,
        prices: [],
        errors: tokens.map((token) => ({
          chainId: token.chainId,
          address: token.address,
          error: error.message || 'Provider error',
        })),
        latency,
      };
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const apiKeyParam = this.apiKey
        ? `?x_cg_demo_api_key=${this.apiKey}`
        : '';
      await this.makeRequest(`${this.baseUrl}/ping${apiKeyParam}`);
      return true;
    } catch (error) {
      this.logger.error(`Health check failed: ${error.message}`);
      return false;
    }
  }
}
