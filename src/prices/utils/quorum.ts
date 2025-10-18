import { Logger } from '@nestjs/common';

export class QuorumChecker {
  private static readonly logger = new Logger('QuorumChecker');

  /**
   * Check if we have enough valid responses to proceed
   */
  static hasQuorum(
    validCount: number,
    totalProviders: number,
    requiredQuorum: number,
  ): boolean {
    const hasQuorum = validCount >= requiredQuorum;

    if (!hasQuorum) {
      this.logger.warn(
        `Quorum not met: ${validCount}/${totalProviders} valid responses (required: ${requiredQuorum})`,
      );
    } else {
      this.logger.log(
        `Quorum met: ${validCount}/${totalProviders} valid responses`,
      );
    }

    return hasQuorum;
  }

  /**
   * Calculate success rate
   */
  static calculateSuccessRate(
    successCount: number,
    totalCount: number,
  ): number {
    if (totalCount === 0) return 0;
    return successCount / totalCount;
  }

  /**
   * Determine if we should wait for more responses
   */
  static shouldWaitForMore(
    currentValid: number,
    currentTotal: number,
    requiredQuorum: number,
    remainingProviders: number,
  ): boolean {
    // If we already have quorum, no need to wait
    if (currentValid >= requiredQuorum) {
      return false;
    }

    // If even with all remaining providers we can't reach quorum, don't wait
    const maxPossible = currentValid + remainingProviders;
    if (maxPossible < requiredQuorum) {
      this.logger.warn(
        `Cannot reach quorum even with all providers: max possible ${maxPossible}, required ${requiredQuorum}`,
      );
      return false;
    }

    // Otherwise, wait for more responses
    return true;
  }
}
