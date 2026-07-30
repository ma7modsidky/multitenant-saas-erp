import { Injectable, Logger } from '@nestjs/common';

/**
 * Upload URL response.
 */
export interface UploadUrl {
  /** The presigned URL for uploading */
  url: string;
  /** The key/path of the uploaded object */
  key: string;
  /** Expiry timestamp */
  expiresAt: string;
}

/**
 * Download URL response.
 */
export interface DownloadUrl {
  /** The presigned URL for downloading */
  url: string;
  /** The key/path of the object */
  key: string;
  /** Expiry timestamp */
  expiresAt: string;
}

/**
 * StorageService — file storage abstraction.
 *
 * Provides presigned URL generation for upload and download operations.
 * Keys are namespaced by organization ID to prevent cross-tenant access.
 *
 * Phase 1.11 uses an in-memory stub.
 * Phase 2+ will implement with Cloudflare R2 or S3.
 *
 * @see PLAN.md §1.11 — Storage
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);

  /**
   * Generate a presigned URL for uploading a file.
   *
   * @param organizationId — Tenant context for key namespacing
   * @param folder — Folder path within the org's storage
   * @param filename — Original filename
   * @param contentType — MIME type of the file
   * @param expiresInSeconds — URL expiry (default: 3600 = 1 hour)
   */
  async getUploadUrl(
    organizationId: string,
    folder: string,
    filename: string,
    contentType: string,
    expiresInSeconds = 3600,
  ): Promise<UploadUrl> {
    // Key namespaced by org for tenant isolation
    const key = `${organizationId}/${folder}/${Date.now()}-${filename}`;

    this.logger.debug(`Upload URL generated: ${key} (expires in ${expiresInSeconds}s)`);

    return {
      url: `https://storage.example.com/upload/${key}`,
      key,
      expiresAt: new Date(Date.now() + expiresInSeconds * 1000).toISOString(),
    };
  }

  /**
   * Generate a presigned URL for downloading a file.
   *
   * @param organizationId — Tenant context for key namespacing
   * @param key — The storage key of the object
   * @param expiresInSeconds — URL expiry (default: 3600)
   */
  async getDownloadUrl(
    organizationId: string,
    key: string,
    expiresInSeconds = 3600,
  ): Promise<DownloadUrl> {
    this.logger.debug(`Download URL generated: ${key} (expires in ${expiresInSeconds}s)`);

    return {
      url: `https://storage.example.com/download/${key}`,
      key,
      expiresAt: new Date(Date.now() + expiresInSeconds * 1000).toISOString(),
    };
  }

  /**
   * Delete an object from storage.
   */
  async deleteObject(organizationId: string, key: string): Promise<void> {
    this.logger.debug(`Object deleted: ${key}`);
  }

  /**
   * Check if an object exists.
   */
  async objectExists(organizationId: string, key: string): Promise<boolean> {
    this.logger.debug(`Object existence check: ${key}`);
    return true; // Stub — always returns true
  }
}
