// Permission helpers.
//
// Permission keys follow the `module:resource:action` convention. A `manage`
// action on any level implies all actions below it, and the literal key
// `manage` grants everything within its scope.

export type PermissionKey = string;

/**
 * Check whether a granted permission set satisfies a required key.
 * Wildcards: `*` matches everything; `module:*` matches any resource/action;
 * `module:resource:manage` matches any action on that resource;
 * `module:manage` matches any resource/action in the module.
 */
export function hasPermission(granted: readonly string[], required: PermissionKey): boolean {
  if (required === '*') return true;
  const [reqModule, reqResource, reqAction] = required.split(':');
  return granted.some((grant) => {
    if (grant === '*') return true;
    const [mod, res, action] = grant.split(':');
    if (mod !== reqModule) return false;
    if (res === '*') return true;
    if (res === 'manage') return true;
    if (res !== reqResource) return false;
    if (action === '*' || action === 'manage') return true;
    return action === reqAction;
  });
}
