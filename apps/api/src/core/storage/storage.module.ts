import { Global, Module } from '@nestjs/common';
import { StorageService } from './storage.service.js';

/**
 * StorageModule — file storage abstraction.
 *
 * Provides:
 *   - StorageService: presigned URL generation for upload/download
 *     with keys namespaced by organization ID
 *
 * Phase 1.11 uses a stub implementation.
 * Phase 2+ will implement with Cloudflare R2 or S3.
 *
 * @see PLAN.md §1.11 — Storage
 */
@Global()
@Module({
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
