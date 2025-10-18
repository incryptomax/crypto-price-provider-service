import { Controller, Post, Body, HttpCode } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiSecurity,
  ApiBadRequestResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { PricesService } from './prices.service';
import { PriceRequestDto } from './dto/price-request.dto';
import { PriceResponseDto } from './dto/price-response.dto';
import { MetricsService } from '../observability/metrics/metrics.service';

@ApiTags('Prices')
@Controller('prices')
export class PricesController {
  constructor(
    private readonly pricesService: PricesService,
    private readonly metricsService: MetricsService,
  ) {}

  @Post()
  @HttpCode(200)
  @ApiOperation({
    summary: 'Get aggregated prices for multiple tokens',
    description:
      'Fetches prices from multiple providers, filters outliers, and returns the most accurate price for each token',
  })
  @ApiSecurity('api-key')
  @ApiResponse({
    status: 200,
    description: 'Prices fetched successfully',
    type: PriceResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Invalid request (e.g., too many tokens, invalid addresses)',
  })
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid API key',
  })
  async getPrices(@Body() request: PriceRequestDto): Promise<PriceResponseDto> {
    const startTime = Date.now();

    try {
      const tokens = await this.pricesService.getPrices(request.tokens);

      // Record metrics
      const latency = (Date.now() - startTime) / 1000;
      this.metricsService.recordApiRequest('POST', '/api/prices', 200);
      this.metricsService.recordApiLatency('POST', '/api/prices', latency);

      return {
        tokens,
      };
    } catch (error) {
      // Record error metric
      const latency = (Date.now() - startTime) / 1000;
      this.metricsService.recordApiRequest('POST', '/api/prices', 500);
      this.metricsService.recordApiLatency('POST', '/api/prices', latency);
      throw error;
    }
  }
}
