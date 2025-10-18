import { Logger } from '@nestjs/common';
import { TokenPrice } from '../providers/provider.interface';

export interface AggregationResult {
  price: number;
  sources: string[];
  metadata: {
    name?: string;
    symbol?: string;
    logo?: string;
    decimals?: number;
  };
  timestamp: number;
}

export class PriceAggregator {
  private static readonly logger = new Logger('PriceAggregator');

  /**
   * Aggregate prices by calculating median
   * Also merge metadata from all sources
   */
  static aggregate(
    prices: Array<{ price: TokenPrice; source: string }>,
  ): AggregationResult | null {
    if (prices.length === 0) {
      return null;
    }

    // Calculate median price
    const priceValues = prices.map((p) => p.price.price);
    const median = this.calculateMedian(priceValues);

    // Collect sources
    const sources = prices.map((p) => p.source);

    // Merge metadata (prefer non-null values)
    const metadata = this.mergeMetadata(prices.map((p) => p.price));

    this.logger.log(
      `Aggregated price: $${median.toFixed(2)} from ${sources.length} sources: ${sources.join(', ')}`,
    );

    return {
      price: median,
      sources,
      metadata,
      timestamp: Date.now(),
    };
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

  private static mergeMetadata(
    prices: TokenPrice[],
  ): AggregationResult['metadata'] {
    const metadata: AggregationResult['metadata'] = {};

    // Find first non-null value for each field
    for (const price of prices) {
      if (!metadata.name && price.name) metadata.name = price.name;
      if (!metadata.symbol && price.symbol) metadata.symbol = price.symbol;
      if (!metadata.logo && price.logo) metadata.logo = price.logo;
      if (!metadata.decimals && price.decimals)
        metadata.decimals = price.decimals;

      // If all fields are filled, break early
      if (
        metadata.name &&
        metadata.symbol &&
        metadata.logo &&
        metadata.decimals
      ) {
        break;
      }
    }

    return metadata;
  }

  /**
   * Calculate average (alternative to median)
   */
  static calculateAverage(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((sum, val) => sum + val, 0) / values.length;
  }

  /**
   * Calculate weighted average based on provider reliability
   */
  static calculateWeightedAverage(
    values: Array<{ price: number; weight: number }>,
  ): number {
    if (values.length === 0) return 0;

    const totalWeight = values.reduce((sum, v) => sum + v.weight, 0);
    if (totalWeight === 0) return 0;

    const weightedSum = values.reduce((sum, v) => sum + v.price * v.weight, 0);
    return weightedSum / totalWeight;
  }
}
