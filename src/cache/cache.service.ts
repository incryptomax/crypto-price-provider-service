import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import {
  CacheOptions,
  SingleflightResult,
  CacheStats,
} from './cache.interface';

@Injectable()
export class CacheService implements OnModuleDestroy {
  private readonly logger = new Logger(CacheService.name);
  private redis: Redis | null = null;
  private fallbackCache: Map<string, { value: string; expiry: number }> =
    new Map();
  private readonly maxFallbackSize = 1000;
  private stats: CacheStats = { hits: 0, misses: 0, errors: 0 };
  private readonly defaultTTL: number;
  private readonly lockTimeout: number;

  constructor(private configService: ConfigService) {
    this.defaultTTL = this.configService.get<number>('CACHE_TTL_SECONDS', 2);
    this.lockTimeout = this.configService.get<number>(
      'SINGLEFLIGHT_LOCK_MS',
      1500,
    );
    this.initializeRedis();
  }

  private initializeRedis() {
    try {
      const redisUrl = this.configService.get<string>(
        'REDIS_URL',
        'redis://localhost:6379/0',
      );
      this.redis = new Redis(redisUrl, {
        retryStrategy: (times) => {
          if (times > 3) {
            this.logger.warn('Redis connection failed, using fallback cache');
            return null;
          }
          return Math.min(times * 100, 2000);
        },
        maxRetriesPerRequest: 3,
      });

      this.redis.on('error', (err) => {
        this.logger.error(`Redis error: ${err.message}`);
        this.stats.errors++;
      });

      this.redis.on('connect', () => {
        this.logger.log('Redis connected successfully');
      });
    } catch (error) {
      this.logger.error(`Failed to initialize Redis: ${error.message}`);
      this.redis = null;
    }
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      if (this.redis && this.redis.status === 'ready') {
        const value = await this.redis.get(key);
        if (value) {
          this.stats.hits++;
          return JSON.parse(value) as T;
        }
        this.stats.misses++;
        return null;
      }

      // Fallback to in-memory cache
      return this.getFallback<T>(key);
    } catch (error) {
      this.logger.error(`Cache get error for key ${key}: ${error.message}`);
      this.stats.errors++;
      return this.getFallback<T>(key);
    }
  }

  async set(
    key: string,
    value: unknown,
    options?: CacheOptions,
  ): Promise<void> {
    const ttl = options?.ttl || this.defaultTTL;
    const serialized = JSON.stringify(value);

    try {
      if (this.redis && this.redis.status === 'ready') {
        await this.redis.setex(key, ttl, serialized);
      } else {
        this.setFallback(key, serialized, ttl);
      }
    } catch (error) {
      this.logger.error(`Cache set error for key ${key}: ${error.message}`);
      this.stats.errors++;
      this.setFallback(key, serialized, ttl);
    }
  }

  async del(key: string): Promise<void> {
    try {
      if (this.redis && this.redis.status === 'ready') {
        await this.redis.del(key);
      }
      this.fallbackCache.delete(key);
    } catch (error) {
      this.logger.error(`Cache delete error for key ${key}: ${error.message}`);
      this.stats.errors++;
    }
  }

  /**
   * Singleflight pattern: ensures only one request fetches data for a given key
   * Other concurrent requests wait for the result
   */
  async singleflight<T>(
    key: string,
    fetchFn: () => Promise<T>,
    options?: CacheOptions,
  ): Promise<SingleflightResult<T>> {
    const startTime = Date.now();

    // Try to get from cache first
    const cached = await this.get<T>(key);
    if (cached !== null) {
      return { value: cached, fromCache: true };
    }

    // Try to acquire lock
    const lockKey = `${key}:lock`;
    const readyKey = `${key}:ready`;
    const lockAcquired = await this.acquireLock(lockKey);

    if (lockAcquired) {
      try {
        // We have the lock, fetch the data
        const value = await fetchFn();
        await this.set(key, value, options);

        // Notify waiting requests
        await this.notifyReady(readyKey);

        return { value, fromCache: false };
      } finally {
        await this.releaseLock(lockKey);
      }
    } else {
      // Wait for the lock holder to finish
      const value = await this.waitForReady<T>(key, readyKey);
      const waitTime = Date.now() - startTime;

      if (value !== null) {
        return { value, fromCache: true, waitTime };
      }

      // Timeout or error, fetch ourselves
      const fetchedValue = await fetchFn();
      await this.set(key, fetchedValue, options);
      return { value: fetchedValue, fromCache: false, waitTime };
    }
  }

  private async acquireLock(lockKey: string): Promise<boolean> {
    try {
      if (this.redis && this.redis.status === 'ready') {
        const result = await this.redis.set(
          lockKey,
          '1',
          'PX',
          this.lockTimeout,
          'NX',
        );
        return result === 'OK';
      }
      return true; // Fallback: always acquire lock
    } catch (error) {
      this.logger.error(`Lock acquisition error: ${error.message}`);
      return true;
    }
  }

  private async releaseLock(lockKey: string): Promise<void> {
    try {
      if (this.redis && this.redis.status === 'ready') {
        await this.redis.del(lockKey);
      }
    } catch (error) {
      this.logger.error(`Lock release error: ${error.message}`);
    }
  }

  private async notifyReady(readyKey: string): Promise<void> {
    try {
      if (this.redis && this.redis.status === 'ready') {
        await this.redis.rpush(readyKey, '1');
        await this.redis.expire(readyKey, 2);
      }
    } catch (error) {
      this.logger.error(`Notify ready error: ${error.message}`);
    }
  }

  private async waitForReady<T>(
    key: string,
    readyKey: string,
  ): Promise<T | null> {
    try {
      if (this.redis && this.redis.status === 'ready') {
        // Wait for notification with timeout
        const result = await this.redis.blpop(
          readyKey,
          Math.floor(this.lockTimeout / 1000),
        );

        if (result) {
          // Data should be ready now
          return await this.get<T>(key);
        }
      }
      return null;
    } catch (error) {
      this.logger.error(`Wait for ready error: ${error.message}`);
      return null;
    }
  }

  private getFallback<T>(key: string): T | null {
    const entry = this.fallbackCache.get(key);
    if (entry && entry.expiry > Date.now()) {
      this.stats.hits++;
      return JSON.parse(entry.value) as T;
    }
    this.stats.misses++;
    return null;
  }

  private setFallback(key: string, value: string, ttl: number): void {
    // LRU eviction if cache is full
    if (this.fallbackCache.size >= this.maxFallbackSize) {
      const firstKey = this.fallbackCache.keys().next().value;
      this.fallbackCache.delete(firstKey);
    }

    this.fallbackCache.set(key, {
      value,
      expiry: Date.now() + ttl * 1000,
    });
  }

  getStats(): CacheStats {
    return { ...this.stats };
  }

  async healthCheck(): Promise<boolean> {
    try {
      if (this.redis && this.redis.status === 'ready') {
        await this.redis.ping();
        return true;
      }
      return false;
    } catch (error) {
      return false;
    }
  }

  async onModuleDestroy() {
    if (this.redis) {
      await this.redis.quit();
    }
  }
}
