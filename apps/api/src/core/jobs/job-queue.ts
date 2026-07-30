import { Injectable, Logger } from '@nestjs/common';

/**
 * A job to be processed asynchronously.
 */
export interface Job<T = Record<string, unknown>> {
  /** Unique job ID */
  readonly id: string;
  /** Job type/name (e.g., 'send-email', 'sync-fx-rates') */
  readonly type: string;
  /** Job payload — must be JSON-serializable */
  readonly payload: T;
  /** Organization context (TEN-6) */
  readonly organizationId?: string;
  /** User context */
  readonly userId?: string;
  /** ISO 8601 timestamp */
  readonly createdAt: string;
  /** Job status */
  status: 'pending' | 'active' | 'completed' | 'failed';
  /** Number of retry attempts */
  attempts: number;
  /** Max retries before dead-letter */
  maxRetries: number;
  /** Last error message */
  lastError: string | null;
}

/**
 * JobQueue — interface for async job processing.
 *
 * Phase 1.11 uses an in-memory implementation.
 * Phase 2+ will replace with BullMQ backed by Redis.
 *
 * Jobs carry organizationId and re-establish tenant context
 * before database access (TEN-6).
 *
 * @see TEN-6 — Jobs re-establish tenant context before db access
 * @see PLAN.md §1.11 — Jobs
 */
export interface IJobQueue {
  /** Add a job to the queue */
  add(
    type: string,
    payload: Record<string, unknown>,
    options?: {
      organizationId?: string;
      userId?: string;
      delay?: number;
      priority?: number;
    },
  ): Promise<Job>;

  /** Get the next pending job (for processor implementation) */
  getNext(type?: string): Promise<Job | undefined>;

  /** Mark a job as completed */
  complete(jobId: string): Promise<void>;

  /** Mark a job as failed with error */
  fail(jobId: string, error: string): Promise<void>;

  /** Get job status */
  getStatus(jobId: string): Promise<Job | undefined>;
}

/**
 * InMemoryJobQueue — in-memory implementation of IJobQueue.
 *
 * Used for development and testing. Jobs are lost on process restart.
 * Phase 2+ will replace with BullMQ + Redis.
 *
 * @see TEN-6 — Jobs re-establish tenant context
 */
@Injectable()
export class InMemoryJobQueue implements IJobQueue {
  private readonly logger = new Logger(InMemoryJobQueue.name);
  private readonly jobs: Job[] = [];
  private nextId = 1;

  async add(
    type: string,
    payload: Record<string, unknown>,
    options?: {
      organizationId?: string;
      userId?: string;
      delay?: number;
      priority?: number;
    },
  ): Promise<Job> {
    // Use conditional spread for optional fields to satisfy exactOptionalPropertyTypes
    const job: Job = {
      id: String(this.nextId++),
      type,
      payload,
      ...(options?.organizationId !== undefined ? { organizationId: options.organizationId } : {}),
      ...(options?.userId !== undefined ? { userId: options.userId } : {}),
      createdAt: new Date().toISOString(),
      status: 'pending',
      attempts: 0,
      maxRetries: 3,
      lastError: null,
    };

    this.jobs.push(job);
    this.logger.debug(`Job added: ${type} (${job.id})`);

    return job;
  }

  async getNext(type?: string): Promise<Job | undefined> {
    const pending = this.jobs.filter((j) => {
      if (j.status !== 'pending') return false;
      if (type && j.type !== type) return false;
      return true;
    });

    if (pending.length === 0) return undefined;

    const job = pending[0]!;
    job.status = 'active';
    job.attempts++;
    return job;
  }

  async complete(jobId: string): Promise<void> {
    const job = this.jobs.find((j) => j.id === jobId);
    if (job) {
      job.status = 'completed';
    }
  }

  async fail(jobId: string, error: string): Promise<void> {
    const job = this.jobs.find((j) => j.id === jobId);
    if (job) {
      job.status = 'failed';
      job.lastError = error;
      this.logger.warn(`Job failed: ${job.type} (${jobId}): ${error}`);
    }
  }

  async getStatus(jobId: string): Promise<Job | undefined> {
    return this.jobs.find((j) => j.id === jobId);
  }

  /** Get all jobs for a given type */
  getByType(type: string): Job[] {
    return this.jobs.filter((j) => j.type === type);
  }

  /** Total number of jobs */
  get totalJobs(): number {
    return this.jobs.length;
  }

  /** Number of pending jobs */
  get pendingJobs(): number {
    return this.jobs.filter((j) => j.status === 'pending').length;
  }
}
