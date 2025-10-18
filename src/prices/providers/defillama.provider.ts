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
export class DeFiLlamaProvider extends BaseProvider {
  private readonly baseUrl = 'https://coins.llama.fi';

  constructor(private configService: ConfigService) {
    super('defillama', configService.get<number>('PROVIDERS_TIMEOUT_MS', 500)); // Faster timeout for DeFiLlama
    this.logger.log('DeFiLlama provider initialized (no API key required)');
    this.logger.log(`DeFiLlama rate limit: ${configService.get<number>('DEFILLAMA_RATE_LIMIT', 20.0)} RPS (ULTRA-FAST!)`);
  }

  async getPrice(token: TokenRequest): Promise<ProviderResponse> {
    const startTime = Date.now();

    try {
      // DeFiLlama API endpoint for single token price
      const platform = this.getPlatformName(token.chainId);
      const url = `${this.baseUrl}/prices/current/${platform}:${token.address.toLowerCase()}`;
      
      const data = await this.makeRequest<any>(url, {
        headers: {
          'Accept': 'application/json',
        },
      });

      const latency = Date.now() - startTime;

      const coinKey = `${platform}:${token.address.toLowerCase()}`;
      const coinData = data.coins?.[coinKey];
      
      if (!coinData) {
        throw new Error('Price data not available');
      }

      const price = parseFloat(coinData.price);
      if (isNaN(price) || price <= 0) {
        throw new Error('Invalid price data');
      }

      this.logger.log(
        `Price fetched: ${token.address} = $${price} (${latency}ms)`,
      );

      return this.createSuccessResponse(
        price,
        token,
        {
          name: coinData.symbol || 'Unknown Token',
          symbol: coinData.symbol || 'UNKNOWN',
          logo: this.getFallbackLogo(coinData.symbol),
          decimals: coinData.decimals || 18,
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
      this.logger.log(`Starting DeFiLlama batch request for ${tokens.length} tokens`);

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
          
          const platform = this.getPlatformName(parseInt(chainId));
          
          // Build addresses list for batch request
          const addresses = chainTokens
            .map((token) => `${platform}:${token.address.toLowerCase()}`)
            .join(',');

          const url = `${this.baseUrl}/prices/current/${addresses}`;
          this.logger.log(`DeFiLlama batch URL: ${url}`);
          
          const data = await this.makeRequest<any>(url, {
            headers: {
              'Accept': 'application/json',
            },
          });

          this.logger.log(`DeFiLlama batch response received: ${Object.keys(data.coins || {}).length} prices`);

          // Process results
          chainTokens.forEach((token) => {
            const coinKey = `${platform}:${token.address.toLowerCase()}`;
            const coinData = data.coins?.[coinKey];
            
            if (coinData) {
              const price = parseFloat(coinData.price);
              if (!isNaN(price) && price > 0) {
                allPrices.push({
                  chainId: token.chainId,
                  address: token.address.toLowerCase(),
                  name: coinData.symbol || 'Unknown Token',
                  symbol: coinData.symbol || 'UNKNOWN',
                  logo: this.getFallbackLogo(coinData.symbol),
                  decimals: coinData.decimals || 18,
                  price: price,
                  timestamp: Date.now(),
                });
                this.logger.log(`Added DeFiLlama batch price for ${token.address}: $${price}`);
              } else {
                allErrors.push({
                  chainId: token.chainId,
                  address: token.address,
                  error: 'Invalid price data',
                });
                this.logger.warn(`Invalid price for ${token.address}: ${coinData.price}`);
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
          this.logger.error(`DeFiLlama batch error for chain ${chainId}: ${error.message}`);
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
      this.logger.log(`DeFiLlama batch completed: ${allPrices.length} prices, ${allErrors.length} errors (${latency}ms)`);

      return {
        success: allPrices.length > 0,
        prices: allPrices,
        errors: allErrors,
        latency,
      };
    } catch (error) {
      const latency = Date.now() - startTime;
      this.logger.error(`DeFiLlama batch request failed: ${error.message} (${latency}ms)`);
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

  // Map chain IDs to DeFiLlama platform names
  private getPlatformName(chainId: number): string {
    const platformMap: Record<number, string> = {
      1: 'ethereum',
      56: 'bsc',
      137: 'polygon',
      43114: 'avax',
      250: 'fantom',
      42161: 'arbitrum',
      10: 'optimism',
      8453: 'base',
      100: 'gnosis',
      1284: 'moonbeam',
    };

    const platform = platformMap[chainId];
    if (!platform) {
      throw new Error(`Unsupported chain ID: ${chainId}`);
    }

    return platform;
  }

  // Get fallback logo based on symbol
  private getFallbackLogo(symbol?: string): string {
    if (!symbol) {
      return 'https://assets.coingecko.com/coins/images/1/large/bitcoin.png';
    }

    const symbolLower = symbol.toLowerCase();
    
    // Common token logos
    const logoMap: Record<string, string> = {
      'weth': 'https://assets.coingecko.com/coins/images/2518/large/weth.png',
      'usdc': 'https://assets.coingecko.com/coins/images/6319/large/USD_Coin_icon.png',
      'usdt': 'https://assets.coingecko.com/coins/images/325/large/Tether.png',
      'dai': 'https://assets.coingecko.com/coins/images/9956/large/Badge_Dai.png',
      'wbtc': 'https://assets.coingecko.com/coins/images/7598/large/wrapped_bitcoin_wbtc.png',
      'link': 'https://assets.coingecko.com/coins/images/877/large/chainlink-new-logo.png',
      'uni': 'https://assets.coingecko.com/coins/images/12559/large/uniswap-uni.png',
      'aave': 'https://assets.coingecko.com/coins/images/12645/large/AAVE.png',
    };

    return logoMap[symbolLower] || 'https://assets.coingecko.com/coins/images/1/large/bitcoin.png';
  }

  // DeFiLlama supports multiple chains
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
