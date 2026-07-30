import { ConfigService } from '@modubiz/config';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';

import { AppModule } from './app.module.js';

async function bootstrap(): Promise<void> {
  // Load config first — validates env vars and fails fast if invalid
  const config = new ConfigService(process.env);

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: config.isDev }),
  );

  await app.listen(config.port, '0.0.0.0');
  console.log(`🚀 ModuBiz API running on http://localhost:${config.port}`);
}

void bootstrap();
