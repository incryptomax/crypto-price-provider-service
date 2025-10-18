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
export class MoralisProvider extends BaseProvider {
  private readonly apiKey?: string;
  private readonly baseUrl = 'https://deep-index.moralis.io/api/v2.2';

  constructor(private configService: ConfigService) {
    super('Moralis', configService.get<number>('PROVIDERS_TIMEOUT_MS', 900));
    this.apiKey = configService.get<string>('MORALIS_API_KEY');
  }

  async getPrice(token: TokenRequest): Promise<ProviderResponse> {
    const startTime = Date.now();

    try {
      if (!this.apiKey) {
        throw new Error('Moralis API key not configured');
      }

      const url = `${this.baseUrl}/erc20/${token.address.toLowerCase()}/price?chain=0x${token.chainId.toString(16)}`;

      const data = await this.makeRequest<any>(url, {
        headers: {
          'X-API-Key': this.apiKey,
        },
      });

      const latency = Date.now() - startTime;

      if (!data.usdPrice) {
        throw new Error('Price data not available');
      }

      this.logger.log(
        `Price fetched: ${data.tokenSymbol} = $${data.usdPrice} (${latency}ms)`,
      );

      return this.createSuccessResponse(
        data.usdPrice,
        token,
        {
          name: data.tokenName,
          symbol: data.tokenSymbol,
          logo: data.tokenLogo,
          decimals: data.tokenDecimals,
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
        throw new Error('Moralis API key not configured');
      }

      const allPrices: TokenPrice[] = [];
      const allErrors: { chainId: number; address: string; error: string }[] =
        [];

      // Process tokens in parallel (Moralis doesn't support batch requests)
      const promises = tokens.map(async (token) => {
        try {
          const url = `${this.baseUrl}/erc20/${token.address.toLowerCase()}/price?chain=0x${token.chainId.toString(16)}`;

          const data = await this.makeRequest<any>(url, {
            headers: {
              'X-API-Key': this.apiKey,
            },
          });

          if (data.usdPrice) {
            allPrices.push({
              chainId: token.chainId,
              address: token.address.toLowerCase(),
              name: data.tokenName || 'Unknown',
              symbol: data.tokenSymbol || 'UNKNOWN',
              decimals: data.tokenDecimals || 18,
              price: parseFloat(data.usdPrice),
              timestamp: Date.now(),
            });
          } else {
            allErrors.push({
              chainId: token.chainId,
              address: token.address,
              error: 'Token not found',
            });
          }
        } catch (error) {
          allErrors.push({
            chainId: token.chainId,
            address: token.address,
            error: error.message || 'Provider error',
          });
        }
      });

      await Promise.all(promises);

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
      // Moralis doesn't have a dedicated health endpoint
      return !!this.apiKey;
    } catch (error) {
      return false;
    }
  }
}
