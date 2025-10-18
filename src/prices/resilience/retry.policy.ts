import { retry, handleAll, ExponentialBackoff } from 'cockatiel';
import { Logger } from '@nestjs/common';

export class RetryPolicyFactory {
  private static readonly logger = new Logger('RetryPolicy');

  static create(
    name: string,
    options: {
      maxAttempts?: number;
      initialDelay?: number;
      maxDelay?: number;
    } = {},
  ) {
    const maxAttempts = options.maxAttempts || 2; // 1 retry (2 total attempts)
    const initialDelay = options.initialDelay || 100;
    const maxDelay = options.maxDelay || 500;

    const policy = retry(handleAll, {
      maxAttempts,
      backoff: new ExponentialBackoff({
        initialDelay,
        maxDelay,
      }),
    });

    policy.onRetry(({ attempt }) => {
      this.logger.debug(`Retrying ${name}, attempt ${attempt}`);
    });

    policy.onGiveUp(() => {
      this.logger.warn(`Giving up on ${name} after max attempts`);
    });

    return policy;
  }
}
