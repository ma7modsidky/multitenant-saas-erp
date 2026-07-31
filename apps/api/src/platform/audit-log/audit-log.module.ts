import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../core/database/database.module.js';
import { AuditLogController } from './api/index.js';
import { QueryAuditLogUseCase } from './application/index.js';
import { DrizzleAuditLogRepository } from './infrastructure/repositories/drizzle-audit-log.repository.js';
import { AUDIT_LOG_REPOSITORY } from './ports/index.js';

@Module({
  imports: [DatabaseModule],
  controllers: [AuditLogController],
  providers: [
    QueryAuditLogUseCase,
    {
      provide: AUDIT_LOG_REPOSITORY,
      useClass: DrizzleAuditLogRepository,
    },
  ],
})
export class AuditLogModule {}
