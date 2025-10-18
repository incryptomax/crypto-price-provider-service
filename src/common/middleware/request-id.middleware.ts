import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import { AsyncLocalStorage } from 'async_hooks';

// Global storage for request context
export const requestContext = new AsyncLocalStorage<{ requestId: string }>();

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    // Take from incoming request or generate new
    const requestId = (req.headers['x-request-id'] as string) || randomUUID();

    // Store in request for use in controllers/services
    req['id'] = requestId;

    // Send back in response headers
    res.setHeader('X-Request-ID', requestId);

    // Store in AsyncLocalStorage for access from anywhere (including logs)
    requestContext.run({ requestId }, () => {
      next();
    });
  }
}
