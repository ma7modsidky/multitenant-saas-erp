import { ConfigService } from '@modubiz/config';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import pino from 'pino';

import { AppModule } from './app.module.js';
import { initializeTelemetry } from './core/observability/opentelemetry.setup.js';

async function bootstrap(): Promise<void> {
  // Initialize OpenTelemetry BEFORE NestFactory.create() to capture
  // the full request lifecycle in traces.
  // Fire-and-forget is intentional: OTel init is async but doesn't
  // block the server from starting (it registers instrumentations).
  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  initializeTelemetry();

  // Load config first — validates env vars and fails fast if invalid
  const config = new ConfigService(process.env);

  // Configure structured Pino logger for Fastify
  const loggerConfig = {
    level: config.logLevel,
    ...(config.isDev
      ? {
          transport: {
            target: 'pino-pretty',
            options: {
              colorize: true,
              translateTime: 'HH:MM:ss.l',
              ignore: 'pid,hostname',
            },
          },
        }
      : {
          formatters: {
            level(label: string) {
              return { level: label };
            },
          },
        }),
  };

  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter({ logger: loggerConfig }));

  // CORS — explicit allowlist only (see CODING_STANDARDS.md §12).
  // The web app runs on a different origin than the API in development,
  // so we allow the configured web base URL.
  // NOTE: @fastify/cors defaults `methods` to `GET,HEAD,POST`, which silently
  // CORS-blocks every PATCH/PUT/DELETE from the browser (the preflight fails
  // before the request is sent) — the CRM contact-edit journey caught this.
  // List the verbs the routes actually expose so the preflight matches them.
  app.enableCors({
    origin: [config.webBaseUrl],
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
  });

  await app.listen(config.port, '0.0.0.0');

  // Use pino directly for startup log since LoggerService isn't initialized yet
  const startupLogger = pino(loggerConfig);
  startupLogger.info({ port: config.port }, 'ModuBiz API started');
}

void bootstrap();
