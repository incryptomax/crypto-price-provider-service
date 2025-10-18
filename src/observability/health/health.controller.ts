import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { CacheService } from '../../cache/cache.service';
import { PricesService } from '../../prices/prices.service';

@ApiTags('Observability')
@Controller('healthz')
export class HealthController {
  constructor(
    private readonly cacheService: CacheService,
    private readonly pricesService: PricesService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Health check endpoint',
    description:
      'Returns the health status of the service and its dependencies',
  })
  @ApiResponse({
    status: 200,
    description: 'Service is healthy',
    schema: {
      example: {
        status: 'ok',
        timestamp: '2025-10-15T12:00:00.000Z',
        uptime: 3600,
        cache: {
          healthy: true,
          stats: {
            hits: 1000,
            misses: 100,
            errors: 0,
          },
        },
        providers: {
          coingecko: true,
          moralis: true,
          portals: true,
          '1inch': true,
        },
      },
    },
  })
  async check() {
    const cacheHealthy = await this.cacheService.healthCheck();
    const cacheStats = this.cacheService.getStats();

    const providersHealth = await this.pricesService.healthCheck();

    const overallHealthy = cacheHealthy && providersHealth.healthy;

    return {
      status: overallHealthy ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      cache: {
        healthy: cacheHealthy,
        stats: cacheStats,
      },
      providers: providersHealth.providers,
    };
  }
}
