import pino, { type LoggerOptions } from 'pino';

const opts: LoggerOptions = {
  level: process.env['LOG_LEVEL'] ?? 'info',
};

if (process.env['NODE_ENV'] !== 'production') {
  opts.transport = { target: 'pino-pretty', options: { colorize: true } };
}

export const logger = pino(opts);

export function feedLogger(component: string) {
  return logger.child({ component });
}
