import { AbilityBuilder, type AbilityClass, PureAbility } from '@casl/ability';

/**
 * CASL action types supported in the system.
 *
 * These map to the third segment of a permission key (`<module>:<resource>:<action>`).
 * `manage` is a special CASL action that grants ALL actions on a subject.
 */
/**
 * CASL action types supported in the system.
 *
 * These map to the third segment of a permission key (`<module>:<resource>:<action>`).
 * Common actions include: `create`, `read`, `update`, `delete`, `manage`, `adjust`, `count`.
 * `manage` is a special CASL action that grants ALL actions on a subject.
 *
 * The type is broad (string) to support any module-specific action like
 * `adjust`, `count`, `transfer`, `export`, etc. without type narrowing issues.
 */
export type AppActions = string;

/**
 * CASL subject types.
 * Subjects are `<module>:<resource>` strings, e.g. `inventory:product`.
 * `all` is a special CASL subject that matches any subject.
 */
export type AppSubjects = string | typeof SubjectWildcard;

/**
 * The wildcard symbol used to represent "all subjects" in CASL.
 * Typed as a const so TypeScript preserves the literal type.
 */
export const SubjectWildcard = 'all' as const;

/**
 * Application-level CASL Ability type.
 *
 * @example
 * ```typescript
 * const ability = createAbility(['inventory:product:read', 'inventory:stock:adjust']);
 * ability.can('read', 'inventory:product'); // true
 * ability.can('update', 'inventory:product'); // false
 * ```
 */
export type AppAbility = PureAbility<[AppActions, AppSubjects]>;

/**
 * CASL ability class — needed for AbilityBuilder type inference.
 */
export const AppAbilityClass = PureAbility as AbilityClass<AppAbility>;

/**
 * Create a CASL Ability from an array of permission strings.
 *
 * Each permission string follows the format `<module>:<resource>:<action>`.
 * The function parses each permission and builds a CASL ability that supports:
 *   - Direct permission checks via `ability.can(action, subject)`
 *   - `manage` action grants all actions on a subject
 *   - Subject matching via string prefix
 *
 * @example
 * ```typescript
 * const ability = createAbility(['inventory:product:read', 'inventory:stock:adjust']);
 * ability.can('read', 'inventory:product');      // true
 * ability.can('update', 'inventory:product');    // false
 * ability.can('adjust', 'inventory:stock');      // true
 * ```
 *
 * @see AUTHZ-5 — Permission checks are declarative via @RequiresPermission
 */
export function createAbility(permissions: string[]): AppAbility {
  const { can, build } = new AbilityBuilder(AppAbilityClass);

  for (const permission of permissions) {
    const parts = permission.split(':');

    if (parts.length < 3) {
      // Invalid format, skip
      continue;
    }

    const action = parts[2] as AppActions;
    const subject = `${parts[0]}:${parts[1]}`;

    if (action === 'manage') {
      // `manage` action grants all actions on the subject
      can('manage' as AppActions, subject);
    } else {
      can(action, subject);
    }
  }

  return build();
}

/**
 * Check if a user has a specific permission using their permission list.
 *
 * This is a convenience wrapper around createAbility + ability.can().
 *
 * @example
 * ```typescript
 * const hasPermission = checkPermission(
 *   ['inventory:product:read', 'inventory:stock:adjust'],
 *   'read',
 *   'inventory:product',
 * );
 * // hasPermission === true
 * ```
 */
export function checkPermission(userPermissions: string[], action: AppActions, subject: AppSubjects): boolean {
  const ability = createAbility(userPermissions);
  return ability.can(action, subject);
}
