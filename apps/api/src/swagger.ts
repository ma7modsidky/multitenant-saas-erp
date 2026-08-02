import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { cleanupOpenApiDoc } from 'nestjs-zod';

/**
 * OpenAPI pipeline (Phase 4 Step 4.0.2).
 *
 * TECH_STACK.md locks `@nestjs/swagger` (OpenAPI 3.1) + `nestjs-zod`
 * (DTO/OpenAPI bridge) with "typed client generated into @modubiz/api-client".
 * This module is the single source of truth for the OpenAPI document:
 *
 *   - request bodies are reflected automatically from `createZodDto` classes
 *     used in `@Body()` / `@Query()` positions (via `_OPENAPI_METADATA_FACTORY`);
 *   - response bodies are declared with `@ApiOkResponse({ type })` /
 *     `@ApiCreatedResponse({ type })` referencing `createZodDto` envelopes;
 *   - `cleanupOpenApiDoc` post-processes the zod-derived schemas (removes
 *     empty `type` fields, hoists referenced schemas into `components.schemas`,
 *     normalises `null` handling).
 *
 * Fastify note: `SwaggerModule.createDocument` must run AFTER `await app.init()`
 * so every controller route is registered before the doc is built.
 *
 * We do NOT host the swagger UI in this step — the document is emitted to
 * `packages/api-client/openapi.json` and consumed by `openapi-typescript`
 * (see `packages/api-client` `generate` script and PLAN.md Step 4.0.2 §3).
 */

/**
 * Resolves the monorepo root by walking up from this module's location until
 * `pnpm-workspace.yaml` is found. This works both from source (`src/`) and
 * from the compiled output (`dist/src/`, one directory deeper).
 */
function findRepoRoot(startDir: string): string {
  let dir = startDir;
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('Could not locate pnpm-workspace.yaml — is the repository layout intact?');
}

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = findRepoRoot(MODULE_DIR);

/**
 * Emits the cleaned OpenAPI document to `packages/api-client/openapi.json`.
 * (No env override: process.env is restricted to packages/config per rule 9.)
 */
export const OPENAPI_OUTPUT_PATH = join(REPO_ROOT, 'packages', 'api-client', 'openapi.json');

/**
 * Builds the OpenAPI document for the running Nest application.
 *
 * @param app - The initialised NestFastifyApplication (routes registered)
 * @param opts.outPath - Where to write `openapi.json`; defaults to
 *   `packages/api-client/openapi.json`. Pass `null` to skip writing.
 * @returns The cleaned OpenAPI document (also written to disk by default)
 */
export async function createOpenApiDocument(
  app: NestFastifyApplication,
  opts: { outPath?: string | null } = {},
): Promise<ReturnType<typeof SwaggerModule.createDocument>> {
  const config = new DocumentBuilder()
    .setTitle('ModuBiz API')
    .setDescription('ModuBiz — modular multi-tenant SaaS platform API')
    .setVersion('1.0.0')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, config);
  const cleaned = cleanupOpenApiDoc(document);

  const outPath = opts.outPath === null ? null : (opts.outPath ?? OPENAPI_OUTPUT_PATH);
  if (outPath !== null) {
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, JSON.stringify(cleaned, null, 2), 'utf8');
  }

  return cleaned;
}
