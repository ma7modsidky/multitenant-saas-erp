import { describe, expect, it, beforeEach } from 'vitest';
import { InMemoryJobQueue } from '../job-queue.js';

describe('InMemoryJobQueue', () => {
  let queue: InMemoryJobQueue;

  beforeEach(() => {
    queue = new InMemoryJobQueue();
  });

  describe('add', () => {
    it('adds a job to the queue', async () => {
      const job = await queue.add('send-email', { to: 'user@example.com', template: 'welcome' });

      expect(job.id).toBeDefined();
      expect(job.type).toBe('send-email');
      expect(job.payload).toEqual({ to: 'user@example.com', template: 'welcome' });
      expect(job.status).toBe('pending');
      expect(job.attempts).toBe(0);
      expect(job.maxRetries).toBe(3);
    });

    it('stores organization context (TEN-6)', async () => {
      const job = await queue.add('process-report', {}, {
        organizationId: 'org-123',
        userId: 'user-456',
      });

      expect(job.organizationId).toBe('org-123');
      expect(job.userId).toBe('user-456');
    });

    it('generates unique IDs', async () => {
      const job1 = await queue.add('type-a', {});
      const job2 = await queue.add('type-b', {});
      expect(job1.id).not.toBe(job2.id);
    });
  });

  describe('getNext', () => {
    it('returns the next pending job', async () => {
      await queue.add('email', { to: 'a@b.com' });
      await queue.add('email', { to: 'c@d.com' });

      const job = await queue.getNext();
      expect(job).toBeDefined();
      expect(job!.status).toBe('active');
    });

    it('filters by job type', async () => {
      await queue.add('email', { to: 'a@b.com' });
      await queue.add('report', { type: 'daily' });

      const emailJob = await queue.getNext('email');
      expect(emailJob).toBeDefined();
      expect(emailJob!.type).toBe('email');
    });

    it('returns undefined when no pending jobs', async () => {
      const job = await queue.getNext();
      expect(job).toBeUndefined();
    });

    it('increments attempt count on getNext', async () => {
      await queue.add('test', {});
      const job = await queue.getNext();
      expect(job!.attempts).toBe(1);
    });
  });

  describe('complete', () => {
    it('marks a job as completed', async () => {
      const job = await queue.add('test', {});
      await queue.getNext(); // move to active
      await queue.complete(job.id);

      const status = await queue.getStatus(job.id);
      expect(status!.status).toBe('completed');
    });
  });

  describe('fail', () => {
    it('marks a job as failed with error', async () => {
      const job = await queue.add('test', {});
      await queue.getNext();
      await queue.fail(job.id, 'Connection timeout');

      const status = await queue.getStatus(job.id);
      expect(status!.status).toBe('failed');
      expect(status!.lastError).toBe('Connection timeout');
    });
  });

  describe('getStatus', () => {
    it('returns undefined for non-existent jobs', async () => {
      const status = await queue.getStatus('nonexistent');
      expect(status).toBeUndefined();
    });
  });

  describe('lifecycle', () => {
    it('supports the full add → process → complete lifecycle', async () => {
      const job = await queue.add('process-order', { orderId: 'ord-1' });

      const active = await queue.getNext();
      expect(active!.id).toBe(job.id);
      expect(active!.status).toBe('active');

      await queue.complete(job.id);
      const final = await queue.getStatus(job.id);
      expect(final!.status).toBe('completed');
    });

    it('supports the add → process → fail → check lifecycle', async () => {
      await queue.add('fragile-job', { data: 'test' });
      const active = await queue.getNext();
      await queue.fail(active!.id, 'Processing error');

      const final = await queue.getStatus(active!.id);
      expect(final!.status).toBe('failed');
    });
  });

  describe('metrics', () => {
    it('totalJobs returns correct count', async () => {
      await queue.add('a', {});
      await queue.add('b', {});
      await queue.add('c', {});
      expect(queue.totalJobs).toBe(3);
    });

    it('pendingJobs returns only pending', async () => {
      await queue.add('a', {}); // pending

      const j2 = await queue.add('b', {}); // pending
      await queue.getNext(); // take first

      await queue.add('c', {}); // pending

      expect(queue.pendingJobs).toBe(2); // b and c are still pending
    });
  });
});
