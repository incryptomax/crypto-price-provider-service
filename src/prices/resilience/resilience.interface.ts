import { CircuitBreakerPolicy } from 'cockatiel';
import Bottleneck from 'bottleneck';

export interface ProviderPolicies {
  circuitBreaker: CircuitBreakerPolicy;
  rateLimiter: Bottleneck;
  retryPolicy: any; // Cockatiel retry policy - using any due to complex typing
}

export interface ResilienceConfig {
  circuitBreaker: {
    threshold?: number;
    duration?: number;
  };
  rateLimiter: {
    maxConcurrent?: number;
    minTime?: number;
    reservoir?: number;
    reservoirRefreshAmount?: number;
    reservoirRefreshInterval?: number;
  };
  retryPolicy: {
    maxAttempts?: number;
    initialDelay?: number;
    maxDelay?: number;
  };
}
