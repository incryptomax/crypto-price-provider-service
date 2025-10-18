import { Logger } from '@nestjs/common';

export interface PriceData {
  price: number;
  source: string;
}

export interface FilterResult {
  valid: PriceData[];
  outliers: PriceData[];
}

export class OutlierFilter {
  private static readonly logger = new Logger('OutlierFilter');

  /**
   * Filter outliers using Median + MAD (Median Absolute Deviation)
   * This is a robust statistical method resistant to outliers
   */
  static filter(
    prices: PriceData[],
    options: {
      relativeThreshold?: number; // Relative threshold (e.g., 0.10 = ±10%)
      kFactor?: number; // K factor for MAD (typically 3.5 for outlier detection)
    } = {},
  ): FilterResult {
    const relativeThreshold = options.relativeThreshold || 0.1;
    const kFactor = options.kFactor || 3.5;

    if (prices.length === 0) {
      return { valid: [], outliers: [] };
    }

    if (prices.length === 1) {
      return { valid: prices, outliers: [] };
    }

    if (prices.length === 2) {
      // For 2 prices, check relative difference
      const [p1, p2] = prices;
      const diff = Math.abs(p1.price - p2.price);
      const avg = (p1.price + p2.price) / 2;
      const relativeDiff = diff / avg;

      if (relativeDiff <= relativeThreshold * 2) {
        return { valid: prices, outliers: [] };
      }

      // If difference is too large, keep both but log warning
      this.logger.warn(
        `Large difference between 2 prices: ${p1.price} vs ${p2.price} (${(relativeDiff * 100).toFixed(1)}%)`,
      );
      return { valid: prices, outliers: [] };
    }

    // Calculate median
    const sortedPrices = [...prices].sort((a, b) => a.price - b.price);
    const median = this.calculateMedian(sortedPrices.map((p) => p.price));

    // Calculate MAD (Median Absolute Deviation)
    const absoluteDeviations = sortedPrices.map((p) =>
      Math.abs(p.price - median),
    );
    const mad = this.calculateMedian(absoluteDeviations);

    // Calculate modified z-scores
    const valid: PriceData[] = [];
    const outliers: PriceData[] = [];

    for (const priceData of prices) {
      // Relative threshold check - primary filter
      const relativeDiff = Math.abs(priceData.price - median) / median;

      if (relativeDiff <= relativeThreshold) {
        valid.push(priceData);
        continue;
      }

      // MAD-based robust z-score - secondary filter (more lenient)
      let isOutlier = false;
      if (mad > 0) {
        const modifiedZScore =
          (0.6745 * Math.abs(priceData.price - median)) / mad;
        // Use higher threshold for MAD to be more lenient
        isOutlier = modifiedZScore > kFactor * 2;
      } else {
        // If MAD is 0, all prices are the same, so no outliers
        isOutlier = false;
      }

      if (isOutlier) {
        this.logger.warn(
          `Outlier detected from ${priceData.source}: $${priceData.price} (median: $${median}, diff: ${(relativeDiff * 100).toFixed(1)}%)`,
        );
        outliers.push(priceData);
      } else {
        // If relative diff > threshold but MAD says it's OK, still include it
        valid.push(priceData);
      }
    }

    return { valid, outliers };
  }

  private static calculateMedian(values: number[]): number {
    if (values.length === 0) return 0;

    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);

    if (sorted.length % 2 === 0) {
      return (sorted[mid - 1] + sorted[mid]) / 2;
    }

    return sorted[mid];
  }
}
