import Bottleneck from 'bottleneck';
import { Logger } from '@nestjs/common';

export class RateLimiterFactory {
  private static readonly logger = new Logger('RateLimiter');
  private static limiters = new Map<string, Bottleneck>();

  static create(
    name: string,
    options: {
      maxConcurrent?: number;
      minTime?: number;
      reservoir?: number;
      reservoirRefreshAmount?: number;
      reservoirRefreshInterval?: number;
    } = {},
  ): Bottleneck {
    if (this.limiters.has(name)) {
      return this.limiters.get(name)!;
    }

    const limiter = new Bottleneck({
      maxConcurrent: options.maxConcurrent || 5,
      minTime: options.minTime || 100, // 100ms between requests = 10 RPS
      reservoir: options.reservoir,
      reservoirRefreshAmount: options.reservoirRefreshAmount,
      reservoirRefreshInterval: options.reservoirRefreshInterval,
    });

    limiter.on('failed', (error, _jobInfo) => {
      this.logger.warn(`Rate limiter job failed for ${name}: ${error.message}`);
    });

    limiter.on('depleted', () => {
      this.logger.debug(`Rate limiter depleted for ${name}`);
    });

    this.limiters.set(name, limiter);
    return limiter;
  }

  static get(name: string): Bottleneck | undefined {
    return this.limiters.get(name);
  }
}
