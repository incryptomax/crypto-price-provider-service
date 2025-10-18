import { Module, Global } from '@nestjs/common';
import { MetricsService } from './metrics/metrics.service';
import { MetricsController } from './metrics/metrics.controller';
import { HealthController } from './health/health.controller';
import { PricesModule } from '../prices/prices.module';

@Global()
@Module({
  imports: [PricesModule],
  controllers: [MetricsController, HealthController],
  providers: [MetricsService],
  exports: [MetricsService],
})
export class ObservabilityModule {}
