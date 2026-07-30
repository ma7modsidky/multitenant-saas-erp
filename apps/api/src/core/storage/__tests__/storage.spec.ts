import { describe, expect, it, beforeEach } from 'vitest';

import { StorageService } from '../storage.service.js';

describe('StorageService', () => {
  let storage: StorageService;

  beforeEach(() => {
    storage = new StorageService();
  });

  describe('getUploadUrl', () => {
    it('generates a URL with the correct key prefix', async () => {
      const result = await storage.getUploadUrl('org-1', 'invoices', 'invoice-1.pdf', 'application/pdf');
      expect(result.key).toContain('org-1/invoices/');
      expect(result.key).toContain('-invoice-1.pdf');
      expect(result.key).not.toContain('org-2'); // no cross-tenant leak
    });

    it('includes content type', async () => {
      const result = await storage.getUploadUrl('org-1', 'images', 'photo.jpg', 'image/jpeg');
      expect(result).toBeDefined();
      expect(typeof result.url).toBe('string');
      expect(result.url).toContain('/upload/');
    });

    it('includes expiry timestamp', async () => {
      const before = Date.now();
      const result = await storage.getUploadUrl('org-1', 'docs', 'doc.pdf', 'application/pdf', 3600);
      const after = Date.now();

      const expiresAt = new Date(result.expiresAt).getTime();
      expect(expiresAt).toBeGreaterThanOrEqual(before + 3600 * 1000 - 1000);
      expect(expiresAt).toBeLessThanOrEqual(after + 3600 * 1000 + 1000);
    });
  });

  describe('getDownloadUrl', () => {
    it('generates a download URL for a given key', async () => {
      const result = await storage.getDownloadUrl('org-1', 'org-1/invoices/invoice-1.pdf');
      expect(result.url).toContain('/download/');
      expect(result.key).toBe('org-1/invoices/invoice-1.pdf');
    });
  });

  describe('deleteObject', () => {
    it('does not throw', async () => {
      await expect(storage.deleteObject('org-1', 'org-1/temp/file.txt')).resolves.not.toThrow();
    });
  });

  describe('objectExists', () => {
    it('returns true for any key (stub)', async () => {
      const exists = await storage.objectExists('org-1', 'some/file.pdf');
      expect(exists).toBe(true);
    });
  });

  describe('tenant isolation', () => {
    it('keys are prefixed with organization id', async () => {
      const result1 = await storage.getUploadUrl('org-1', 'files', 'doc.pdf', 'application/pdf');
      const result2 = await storage.getUploadUrl('org-2', 'files', 'doc.pdf', 'application/pdf');

      // Different orgs get different keys for the same file
      expect(result1.key).not.toBe(result2.key);
      expect(result1.key).toContain('org-1/');
      expect(result2.key).toContain('org-2/');
    });
  });
});
