import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHello(): string {
    return 'Crypto Price Provider API is running';
  }

  getInfo() {
    return {
      name: 'Crypto Price Provider API',
      version: '1.0.0',
      description: 'Aggregates cryptocurrency prices from multiple providers',
      endpoints: {
        prices: 'POST /api/prices',
        docs: 'GET /api/docs',
        metrics: 'GET /metrics',
        health: 'GET /healthz',
      },
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    };
  }
}
