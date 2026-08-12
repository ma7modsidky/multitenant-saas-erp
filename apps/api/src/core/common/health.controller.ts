import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { PublicRoute } from '../tenancy/system-context.decorator.js';

/**
 * HealthController — unauthenticated liveness probe.
 *
 * GET /health answers 200 OK without auth or tenant context (JwtAuthGuard and
 * TenantInterceptor both skip @PublicRoute routes), so uptime monitors get a
 * cheap liveness check that never touches the database:
 *
 *   - cron-job.org pings it every 10 minutes to keep the free Render demo
 *     API awake (no cold start on the first real request).
 *   - The API Dockerfile's HEALTHCHECK probes the same path.
 *
 * @see DEMO_DEPLOYMENT.md §10.1 — Keep the API awake (kill the cold start)
 */
@ApiTags('system')
@Controller('health')
export class HealthController {
  /** GET /health — API is up and routing requests. */
  @Get()
  @ApiOkResponse({ description: 'API is up and routing requests' })
  @PublicRoute()
  health(): { data: { status: 'ok' } } {
    return { data: { status: 'ok' } };
  }
}
