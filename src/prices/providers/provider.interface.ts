export interface TokenRequest {
  chainId: number;
  address: string;
}

export interface TokenPrice {
  chainId: number;
  address: string;
  name?: string;
  symbol?: string;
  logo?: string;
  decimals?: number;
  price: number;
  timestamp: number;
}

export interface ProviderResponse {
  success: boolean;
  price?: TokenPrice;
  error?: string;
  latency: number;
  isRateLimitError?: boolean; // HTTP 429
}

export interface BatchProviderResponse {
  success: boolean;
  prices: TokenPrice[];
  errors: Array<{
    chainId: number;
    address: string;
    error: string;
  }>;
  latency: number;
  isRateLimitError?: boolean; // HTTP 429
}

export interface IProvider {
  readonly name: string;
  getPrice(token: TokenRequest): Promise<ProviderResponse>;
  getPrices(tokens: TokenRequest[]): Promise<BatchProviderResponse>;
  healthCheck(): Promise<boolean>;
}
