import { writeSync } from 'node:fs';

import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';

import { AppModule } from './app.module.js';
import { OPENAPI_OUTPUT_PATH, createOpenApiDocument } from './swagger.js';

/**
 * Standalone OpenAPI generation entrypoint.
 *
 * Boots the full Nest application (so every controller route is registered),
 * builds the OpenAPI document, and writes `openapi.json` to
 * `packages/api-client/` for `openapi-typescript`.
 *
 * Usage (from repo root, after `pnpm --filter api run build`):
 *   pnpm --filter api run generate:openapi
 *
 * Requires a live Postgres (the module registry syncs descriptors to the DB
 * in `onModuleInit`) and the `.env` config — the same preconditions as
 * running the dev server.
 */
async function generateOpenApi(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter({ logger: false }), {
    logger: false,
  });

  await app.init();

  await createOpenApiDocument(app, { outPath: OPENAPI_OUTPUT_PATH });

  await app.close();

  // The postgres.js pool (and possibly Redis/OTel) keeps the event loop
  // alive after app.close() — for a one-shot CLI this is the documented
  // way to guarantee termination. The file is flushed by writeFile above.

  console.log(`[generate-openapi] wrote ${OPENAPI_OUTPUT_PATH}`);
  process.exit(0);
}

generateOpenApi().catch((err: unknown) => {
  // Synchronous write (fd 2): `process.exit()` below truncates async
  // console writes, which would silently swallow the failure reason.
  const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
  writeSync(2, `[generate-openapi] failed: ${detail}\n`);
  process.exit(1);
});
