import { Logger } from '@nestjs/common';
import { request } from 'undici';
import {
  IProvider,
  TokenRequest,
  ProviderResponse,
  BatchProviderResponse,
} from './provider.interface';

export abstract class BaseProvider implements IProvider {
  protected readonly logger: Logger;
  protected readonly timeout: number;

  constructor(
    public readonly name: string,
    timeout: number = 900,
  ) {
    this.logger = new Logger(`${name}Provider`);
    this.timeout = timeout;
  }

  abstract getPrice(token: TokenRequest): Promise<ProviderResponse>;

  abstract getPrices(tokens: TokenRequest[]): Promise<BatchProviderResponse>;

  abstract healthCheck(): Promise<boolean>;

  protected async makeRequest<T>(
    url: string,
    options?: {
      method?: string;
      headers?: Record<string, string>;
      body?: Record<string, unknown>;
    },
  ): Promise<T> {
    const startTime = Date.now();

    try {
      const response = await request(url, {
        method: (options?.method || 'GET') as any,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'CryptoPriceProvider/1.0',
          ...options?.headers,
        },
        body: options?.body ? JSON.stringify(options.body) : undefined,
        headersTimeout: Number(this.timeout) || 900,
        bodyTimeout: Number(this.timeout) || 900,
      });

      const latency = Date.now() - startTime;

      if (response.statusCode === 429) {
        const error = new Error(`HTTP 429: Rate limit exceeded`) as Error & {
          isRateLimitError?: boolean;
          statusCode?: number;
        };
        error.isRateLimitError = true;
        error.statusCode = 429;
        throw error;
      }

      if (response.statusCode !== 200) {
        throw new Error(`HTTP ${response.statusCode}: ${response.statusCode}`);
      }

      const data = await response.body.json();
      this.logger.debug(`Request successful (${latency}ms): ${url}`);

      return data as T;
    } catch (error) {
      const latency = Date.now() - startTime;
      this.logger.error(
        `Request failed (${latency}ms): ${url} - ${error.message}`,
      );
      throw error;
    }
  }

  protected createErrorResponse(
    error: Error & { isRateLimitError?: boolean },
    latency: number,
  ): ProviderResponse {
    return {
      success: false,
      error: error.message,
      latency,
      isRateLimitError: error.isRateLimitError || false,
    };
  }

  protected createSuccessResponse(
    price: number,
    token: TokenRequest,
    metadata: {
      name?: string;
      symbol?: string;
      logo?: string;
      decimals?: number;
    },
    latency: number,
  ): ProviderResponse {
    return {
      success: true,
      price: {
        chainId: token.chainId,
        address: token.address.toLowerCase(),
        name: metadata.name,
        symbol: metadata.symbol,
        logo: metadata.logo,
        decimals: metadata.decimals,
        price,
        timestamp: Date.now(),
      },
      latency,
    };
  }
}
