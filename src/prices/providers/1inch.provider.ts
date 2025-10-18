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
export class OneInchProvider extends BaseProvider {
  private readonly apiKey?: string;
  private readonly baseUrl = 'https://api.1inch.com';

  constructor(private configService: ConfigService) {
    super('1inch', configService.get<number>('PROVIDERS_TIMEOUT_MS', 900));
    this.apiKey = configService.get<string>('ONEINCH_API_KEY');
    
    if (!this.apiKey) {
      this.logger.warn('1inch API key not configured - provider will be disabled');
    }
  }

  async getPrice(token: TokenRequest): Promise<ProviderResponse> {
    const startTime = Date.now();

    try {
      if (!this.apiKey) {
        throw new Error('1inch API key not configured');
      }

      // 1inch API endpoint for price with USD currency
      const url = `${this.baseUrl}/price/v1.1/${token.chainId}/${token.address.toLowerCase()}?currency=USD`;
      
      const data = await this.makeRequest<any>(url, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Accept': 'application/json',
        },
      });

      const latency = Date.now() - startTime;

      if (!data[token.address.toLowerCase()]) {
        throw new Error('Price data not available');
      }

      const priceInUsd = parseFloat(data[token.address.toLowerCase()]);
      if (isNaN(priceInUsd) || priceInUsd <= 0) {
        throw new Error('Invalid price data');
      }

      this.logger.log(
        `Price fetched: ${token.address} = $${priceInUsd} (${latency}ms)`,
      );

      return this.createSuccessResponse(
        priceInUsd,
        token,
        {
          name: 'Unknown Token',
          symbol: 'UNKNOWN',
          logo: 'https://assets.coingecko.com/coins/images/1/large/bitcoin.png',
          decimals: 18,
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
      if (!this.apiKey) {
        throw new Error('1inch API key not configured');
      }

      this.logger.log(`Starting 1inch batch request for ${tokens.length} tokens`);

      const allPrices: TokenPrice[] = [];
      const allErrors: { chainId: number; address: string; error: string }[] = [];

      // Group tokens by chainId for batch requests
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

      this.logger.log(`Grouped tokens by chain: ${Object.keys(tokensByChain).join(', ')}`);

      // Process each chain separately
      for (const [chainId, chainTokens] of Object.entries(tokensByChain)) {
        try {
          this.logger.log(`Processing chain ${chainId} with ${chainTokens.length} tokens`);
          
          // Build addresses list for batch request
          const addresses = chainTokens
            .map((token) => token.address.toLowerCase())
            .join(',');

          const url = `${this.baseUrl}/price/v1.1/${chainId}/${addresses}?currency=USD`;
          this.logger.log(`1inch batch URL: ${url}`);
          
          const data = await this.makeRequest<any>(url, {
            headers: {
              'Authorization': `Bearer ${this.apiKey}`,
              'Accept': 'application/json',
            },
          });

          this.logger.log(`1inch batch response received: ${Object.keys(data).length} prices`);

          // Process results
          chainTokens.forEach((token) => {
            const priceString = data[token.address.toLowerCase()];
            if (priceString) {
              const priceInUsd = parseFloat(priceString);
              if (!isNaN(priceInUsd) && priceInUsd > 0) {
                allPrices.push({
                  chainId: token.chainId,
                  address: token.address.toLowerCase(),
                  name: 'Unknown Token',
                  symbol: 'UNKNOWN',
                  logo: 'https://assets.coingecko.com/coins/images/1/large/bitcoin.png',
                  decimals: 18,
                  price: priceInUsd,
                  timestamp: Date.now(),
                });
                this.logger.log(`Added 1inch batch price for ${token.address}: $${priceInUsd}`);
              } else {
                allErrors.push({
                  chainId: token.chainId,
                  address: token.address,
                  error: 'Invalid price data',
                });
                this.logger.warn(`Invalid price for ${token.address}: ${priceString}`);
              }
            } else {
              allErrors.push({
                chainId: token.chainId,
                address: token.address,
                error: 'Token not found',
              });
              this.logger.warn(`Price not found for ${token.address}`);
            }
          });
        } catch (error) {
          this.logger.error(`1inch batch error for chain ${chainId}: ${error.message}`);
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
      this.logger.log(`1inch batch completed: ${allPrices.length} prices, ${allErrors.length} errors (${latency}ms)`);

      return {
        success: allPrices.length > 0,
        prices: allPrices,
        errors: allErrors,
        latency,
      };
    } catch (error) {
      const latency = Date.now() - startTime;
      this.logger.error(`1inch batch request failed: ${error.message} (${latency}ms)`);
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
      if (!this.apiKey) {
        return false;
      }

      // Simple health check - try to get price for WETH
      const testToken: TokenRequest = {
        chainId: 1,
        address: '0xC02aaA39b223FE8D0a0e5C4F27eAD9083C756Cc2', // WETH
      };

      const response = await this.getPrice(testToken);
      return response.success;
    } catch (error) {
      this.logger.error(`Health check failed: ${error.message}`);
      return false;
    }
  }

  // 1inch supports multiple chains
  getSupportedChains(): number[] {
    return [
      1,    // Ethereum
      56,   // BSC
      137,  // Polygon
      43114, // Avalanche
      250,  // Fantom
      42161, // Arbitrum
      10,   // Optimism
      8453, // Base
      100,  // Gnosis
      1284, // Moonbeam
    ];
  }
}
