import { Injectable } from '@nestjs/common';
import {
  Counter,
  Histogram,
  register,
  collectDefaultMetrics,
} from 'prom-client';

@Injectable()
export class MetricsService {
  // API Metrics
  public readonly apiRequestsTotal: Counter;
  public readonly apiLatencySeconds: Histogram;

  // Provider Metrics
  public readonly providerCallsTotal: Counter;
  public readonly providerLatencySeconds: Histogram;
  public readonly providerOutliersTotal: Counter;
  public readonly providerRateLimitErrorsTotal: Counter;

  // Aggregation Metrics
  public readonly aggregationQuorumTotal: Counter;

  // Cache Metrics
  public readonly cacheHitsTotal: Counter;
  public readonly singleflightWaitSeconds: Histogram;

  constructor() {
    // Enable default metrics (CPU, memory, etc.)
    collectDefaultMetrics({ register });

    // API Metrics
    this.apiRequestsTotal = new Counter({
      name: 'api_requests_total',
      help: 'Total number of API requests',
      labelNames: ['method', 'endpoint', 'status'],
      registers: [register],
    });

    this.apiLatencySeconds = new Histogram({
      name: 'api_latency_seconds',
      help: 'API request latency in seconds',
      labelNames: ['method', 'endpoint'],
      buckets: [0.01, 0.05, 0.1, 0.2, 0.5, 1, 2, 5],
      registers: [register],
    });

    // Provider Metrics
    this.providerCallsTotal = new Counter({
      name: 'provider_calls_total',
      help: 'Total number of calls to price providers',
      labelNames: ['provider', 'result'],
      registers: [register],
    });

    this.providerLatencySeconds = new Histogram({
      name: 'provider_latency_seconds',
      help: 'Provider call latency in seconds',
      labelNames: ['provider'],
      buckets: [0.05, 0.1, 0.2, 0.5, 0.9, 1.5, 3, 5],
      registers: [register],
    });

    this.providerOutliersTotal = new Counter({
      name: 'provider_outliers_total',
      help: 'Total number of outlier prices detected',
      labelNames: ['provider'],
      registers: [register],
    });

    this.providerRateLimitErrorsTotal = new Counter({
      name: 'provider_rate_limit_errors_total',
      help: 'Total number of rate limit errors (HTTP 429) from providers',
      labelNames: ['provider'],
      registers: [register],
    });

    // Aggregation Metrics
    this.aggregationQuorumTotal = new Counter({
      name: 'aggregation_quorum_total',
      help: 'Total number of aggregations by quorum count',
      labelNames: ['count'],
      registers: [register],
    });

    // Cache Metrics
    this.cacheHitsTotal = new Counter({
      name: 'cache_hits_total',
      help: 'Total number of cache hits',
      labelNames: ['source'],
      registers: [register],
    });

    this.singleflightWaitSeconds = new Histogram({
      name: 'singleflight_wait_seconds',
      help: 'Time spent waiting in singleflight pattern',
      buckets: [0.01, 0.05, 0.1, 0.2, 0.5, 1, 1.5],
      registers: [register],
    });
  }

  // Helper methods for recording metrics
  recordApiRequest(method: string, endpoint: string, status: number) {
    this.apiRequestsTotal.inc({ method, endpoint, status });
  }

  recordApiLatency(method: string, endpoint: string, durationSeconds: number) {
    this.apiLatencySeconds.observe({ method, endpoint }, durationSeconds);
  }

  recordProviderCall(provider: string, result: 'success' | 'error') {
    this.providerCallsTotal.inc({ provider, result });
  }

  recordProviderLatency(provider: string, durationSeconds: number) {
    this.providerLatencySeconds.observe({ provider }, durationSeconds);
  }

  recordOutlier(provider: string) {
    this.providerOutliersTotal.inc({ provider });
  }

  recordQuorum(count: number) {
    this.aggregationQuorumTotal.inc({ count: count.toString() });
  }

  recordCacheHit(source: 'redis' | 'memory') {
    this.cacheHitsTotal.inc({ source });
  }

  recordSingleflightWait(durationSeconds: number) {
    this.singleflightWaitSeconds.observe(durationSeconds);
  }

  recordRateLimitError(provider: string) {
    this.providerRateLimitErrorsTotal.inc({ provider });
  }

  getMetrics(): Promise<string> {
    return register.metrics();
  }

  getContentType(): string {
    return register.contentType;
  }
}
