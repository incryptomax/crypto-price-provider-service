import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BaseProvider } from './base.provider';
import {
  ProviderResponse,
  TokenPrice,
  TokenRequest,
  BatchProviderResponse,
} from './provider.interface';

interface PortalsTokenResponse {
  tokens: {
    key: string;
    name: string;
    symbol: string;
    decimals: number;
    address: string;
    price: number;
    image?: string;
    network: string;
    updatedAt: string;
  }[];
}

@Injectable()
export class PortalsProvider extends BaseProvider {
  private readonly baseUrl = 'https://api.portals.fi/v2';
  private readonly apiKey: string;

  constructor(private readonly configService: ConfigService) {
    super('portals');
    this.apiKey = this.configService.get<string>('PORTALS_API_KEY');
    if (!this.apiKey) {
      this.logger.warn('PORTALS_API_KEY not configured');
    }
  }

  async getPrice(token: TokenRequest): Promise<ProviderResponse> {
    const startTime = Date.now();

    try {
      // Map chainId to network name
      const networkName = this.getNetworkName(token.chainId);
      const tokenId = `${networkName}:${token.address.toLowerCase()}`;
      const url = `${this.baseUrl}/tokens?ids=${tokenId}`;

      const data = await this.makeRequest<PortalsTokenResponse>(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
      });

      if (!data.tokens || data.tokens.length === 0) {
        throw new Error('No token data available');
      }

      const tokenData = data.tokens[0];
      if (!tokenData.price) {
        throw new Error('No price data available');
      }

      const tokenPrice: TokenPrice = {
        chainId: token.chainId,
        address: token.address.toLowerCase(),
        name: tokenData.name,
        symbol: tokenData.symbol,
        decimals: tokenData.decimals,
        logo: tokenData.image,
        price: tokenData.price,
        timestamp: Date.now(),
      };

      const latency = Date.now() - startTime;
      this.logger.debug(
        `Price fetched: ${tokenData.symbol} = $${tokenData.price} (${latency}ms)`,
      );

      return {
        success: true,
        price: tokenPrice,
        latency,
      };
    } catch (error) {
      const latency = Date.now() - startTime;
      this.logger.error(
        `Failed to fetch price for ${token.address} on chain ${token.chainId}: ${error.message}`,
      );
      return this.createErrorResponse(error, latency);
    }
  }

  async getPrices(tokens: TokenRequest[]): Promise<BatchProviderResponse> {
    const startTime = Date.now();

    try {
      const allPrices: TokenPrice[] = [];
      const allErrors: { chainId: number; address: string; error: string }[] =
        [];

      // Group tokens by network
      const tokensByNetwork = tokens.reduce(
        (acc, token) => {
          const network = this.getNetworkName(token.chainId);
          if (!acc[network]) {
            acc[network] = [];
          }
          acc[network].push(token);
          return acc;
        },
        {} as Record<string, TokenRequest[]>,
      );

      // Process each network separately
      for (const [network, networkTokens] of Object.entries(tokensByNetwork)) {
        // Build token IDs for this network
        const tokenIds = networkTokens
          .map((token) => `${network}:${token.address.toLowerCase()}`)
          .join(',');

        const url = `${this.baseUrl}/tokens?ids=${tokenIds}`;

        try {
          const data = await this.makeRequest<PortalsTokenResponse>(url, {
            method: 'GET',
            headers: {
              Authorization: `Bearer ${this.apiKey}`,
              'Content-Type': 'application/json',
            },
          });

          // Process results
          networkTokens.forEach((token) => {
            const tokenData = data.tokens.find(
              (t) => t.address.toLowerCase() === token.address.toLowerCase(),
            );
            if (tokenData && tokenData.price) {
              allPrices.push({
                chainId: token.chainId,
                address: token.address.toLowerCase(),
                name: tokenData.name,
                symbol: tokenData.symbol,
                decimals: tokenData.decimals,
                price: tokenData.price,
                timestamp: Date.now(),
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
          // Add error for all tokens in this network
          networkTokens.forEach((token) => {
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
      // Test with a known token (USDT on Ethereum)
      const response = await this.getPrice({
        chainId: 1,
        address: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
      });
      return response.success;
    } catch (error) {
      this.logger.error(`Health check failed: ${error.message}`);
      return false;
    }
  }

  getName(): string {
    return 'portals';
  }

  private getNetworkName(chainId: number): string {
    const networkMap: Record<number, string> = {
      1: 'ethereum',
      56: 'bsc',
      137: 'polygon',
      43114: 'avalanche',
      250: 'fantom',
      42161: 'arbitrum',
      10: 'optimism',
      8453: 'base',
    };

    return networkMap[chainId] || 'ethereum'; // Default to ethereum
  }
}
