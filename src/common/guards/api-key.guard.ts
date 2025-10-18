import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly logger = new Logger(ApiKeyGuard.name);
  private readonly apiKeys: Set<string>;

  constructor(
    private configService: ConfigService,
    private reflector: Reflector,
  ) {
    const keysString = this.configService.get<string>('API_KEYS', '');
    this.apiKeys = new Set(
      keysString
        .split(',')
        .map((key) => key.trim())
        .filter((key) => key.length > 0),
    );

    if (this.apiKeys.size === 0) {
      this.logger.warn('No API keys configured! API will be unprotected.');
    } else {
      this.logger.log(`Loaded ${this.apiKeys.size} API keys`);
    }
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();

    // Allow public access to metrics, health and info endpoints
    const publicPaths = [
      '/metrics',
      '/api/metrics',
      '/healthz',
      '/api/healthz',
      '/api/info',
    ];
    if (publicPaths.includes(request.path)) {
      return true;
    }

    // If no API keys configured, allow all requests (development mode)
    if (this.apiKeys.size === 0) {
      return true;
    }
    const apiKey = this.extractApiKey(request);

    if (!apiKey) {
      this.logger.warn(`Missing API key from ${request.ip}`);
      throw new UnauthorizedException('API key is required');
    }

    if (!this.apiKeys.has(apiKey)) {
      this.logger.warn(`Invalid API key attempt from ${request.ip}`);
      throw new UnauthorizedException('Invalid API key');
    }

    return true;
  }

  private extractApiKey(request: {
    headers: Record<string, string | string[]>;
  }): string | null {
    // Check x-api-key header
    const headerKey = request.headers['x-api-key'];
    if (headerKey) {
      return Array.isArray(headerKey) ? headerKey[0] : headerKey;
    }

    // Check authorization header (Bearer token)
    const authHeader = request.headers['authorization'];
    if (authHeader) {
      const authValue = Array.isArray(authHeader) ? authHeader[0] : authHeader;
      if (authValue.startsWith('Bearer ')) {
        return authValue.substring(7);
      }
    }

    return null;
  }
}
