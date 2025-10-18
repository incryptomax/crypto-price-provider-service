import { WinstonModuleOptions } from 'nest-winston';
import * as winston from 'winston';
import { ConfigService } from '@nestjs/config';
import { requestContext } from '../common/middleware/request-id.middleware';

export const createWinstonLogger = (): WinstonModuleOptions => {
  const configService = new ConfigService();
  const logLevel = configService.get('LOG_LEVEL') || 'info';
  const logFile = configService.get('LOG_FILE') || 'logs/app.log';

  return {
    level: logLevel,
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.errors({ stack: true }),
      winston.format.printf((info) => {
        // Get request ID from AsyncLocalStorage context
        const context = requestContext.getStore();
        const requestId = context?.requestId || 'system';

        return JSON.stringify({
          timestamp: info.timestamp,
          level: info.level,
          requestId,
          context: info.context,
          message: info.message,
          service: 'velvet-test',
          ...info,
        });
      }),
    ),
    defaultMeta: { service: 'velvet-test' },
    transports: [
      // Console transport
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.colorize(),
          winston.format.simple(),
        ),
      }),
      // File transport
      new winston.transports.File({
        filename: logFile,
        format: winston.format.combine(
          winston.format.timestamp(),
          winston.format.printf((info) => {
            const context = requestContext.getStore();
            const requestId = context?.requestId || 'system';

            return JSON.stringify({
              timestamp: info.timestamp,
              level: info.level,
              requestId,
              context: info.context,
              message: info.message,
              service: 'velvet-test',
              ...info,
            });
          }),
        ),
      }),
      // Error file transport
      new winston.transports.File({
        filename: 'logs/error.log',
        level: 'error',
        format: winston.format.combine(
          winston.format.timestamp(),
          winston.format.printf((info) => {
            const context = requestContext.getStore();
            const requestId = context?.requestId || 'system';

            return JSON.stringify({
              timestamp: info.timestamp,
              level: info.level,
              requestId,
              context: info.context,
              message: info.message,
              service: 'velvet-test',
              ...info,
            });
          }),
        ),
      }),
    ],
  };
};
