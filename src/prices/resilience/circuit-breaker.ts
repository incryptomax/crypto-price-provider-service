import { circuitBreaker, ConsecutiveBreaker, handleAll } from 'cockatiel';
import { Logger } from '@nestjs/common';

export class CircuitBreakerFactory {
  private static readonly logger = new Logger('CircuitBreaker');

  static create(
    name: string,
    options: {
      threshold?: number;
      duration?: number;
    } = {},
  ) {
    const duration = options.duration || 30000; // 30 seconds

    const breaker = circuitBreaker(handleAll, {
      halfOpenAfter: duration,
      breaker: new ConsecutiveBreaker(5), // Open after 5 consecutive failures
    });

    breaker.onBreak(() => {
      this.logger.warn(`Circuit breaker opened for ${name}`);
    });

    breaker.onReset(() => {
      this.logger.log(`Circuit breaker reset for ${name}`);
    });

    breaker.onHalfOpen(() => {
      this.logger.log(`Circuit breaker half-open for ${name}`);
    });

    return breaker;
  }
}
