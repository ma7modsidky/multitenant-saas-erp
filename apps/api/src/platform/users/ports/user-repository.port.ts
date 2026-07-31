import type { TxOrDb } from '../../../core/database/repository.base.js';
import { type UserData } from '../domain/index.js';

/**
 * UserRepository — persistence interface for users.
 *
 * core_users is a GLOBAL (non-tenant) table, so the standard
 * RepositoryBase with auto-applied tenant filtering is NOT used.
 *
 * @see DATA_MODEL.md §4.1 — Global (non-tenant) tables
 */
export interface UserRepository {
  /** Find user by their primary key. */
  findById(id: string, tx?: TxOrDb): Promise<UserData | undefined>;

  /** Find user by their normalized email (AUTH-1). */
  findByEmail(email: string, tx?: TxOrDb): Promise<UserData | undefined>;

  /** Check if an email is already registered. */
  isEmailTaken(email: string, excludeUserId?: string, tx?: TxOrDb): Promise<boolean>;

  /** Insert a new user. */
  insert(data: UserData, tx?: TxOrDb): Promise<UserData>;

  /** Update an existing user. */
  update(id: string, data: Partial<UserData>, tx?: TxOrDb): Promise<UserData | undefined>;
}

/** Injection token for the UserRepository. */
export const USER_REPOSITORY = Symbol('USER_REPOSITORY');
