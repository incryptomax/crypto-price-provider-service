export interface CacheOptions {
  ttl?: number; // Time to live in seconds
}

export interface SingleflightResult<T> {
  value: T;
  fromCache: boolean;
  waitTime?: number;
}

export interface CacheStats {
  hits: number;
  misses: number;
  errors: number;
}
