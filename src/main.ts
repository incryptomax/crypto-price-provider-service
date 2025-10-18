import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from 'helmet';
import * as compression from 'compression';
import { AppModule } from './app.module';
import { WinstonModule } from 'nest-winston';
import { createWinstonLogger } from './config/winston.config';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  const app = await NestFactory.create(AppModule, {
    logger: WinstonModule.createLogger(createWinstonLogger()),
  });

  const configService = app.get(ConfigService);
  const port = configService.get('PORT', 8080);

  // Security - Helmet
  app.use(helmet());

  // Compression
  app.use(compression());

  // CORS
  const corsOrigins = configService
    .get('CORS_ORIGINS', 'http://localhost:3000')
    .split(',')
    .map((origin: string) => origin.trim());

  app.enableCors({
    origin: corsOrigins,
    credentials: true,
  });

  // Global prefix
  app.setGlobalPrefix('api');

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // Swagger documentation
  const swaggerConfig = new DocumentBuilder()
    .setTitle(configService.get('SWAGGER_TITLE', 'Crypto Price Provider API'))
    .setDescription(
      configService.get(
        'SWAGGER_DESCRIPTION',
        'API for aggregating cryptocurrency prices from multiple providers',
      ),
    )
    .setVersion(configService.get('SWAGGER_VERSION', '1.0'))
    .addApiKey(
      {
        type: 'apiKey',
        name: 'x-api-key',
        in: 'header',
        description: 'API key for authentication',
      },
      'api-key',
    )
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document);

  // Enable graceful shutdown hooks
  app.enableShutdownHooks();

  await app.listen(port, '0.0.0.0');

  logger.log(`Application is running on: http://localhost:${port}/api`);
  logger.log(`Swagger docs: http://localhost:${port}/api/docs`);
  logger.log(`Metrics: http://localhost:${port}/metrics`);
  logger.log(`Health check: http://localhost:${port}/healthz`);
  logger.log(
    `API Keys configured: ${
      configService
        .get('API_KEYS', '')
        .split(',')
        .filter((k: string) => k).length
    }`,
  );

  // Graceful shutdown on SIGTERM (Kubernetes, Docker)
  process.on('SIGTERM', async () => {
    logger.log('SIGTERM signal received: closing HTTP server gracefully');
    await app.close();
    logger.log('HTTP server closed');
    process.exit(0);
  });

  // Graceful shutdown on SIGINT (Ctrl+C locally)
  process.on('SIGINT', async () => {
    logger.log('SIGINT signal received: closing HTTP server gracefully');
    await app.close();
    logger.log('HTTP server closed');
    process.exit(0);
  });
}

bootstrap();
