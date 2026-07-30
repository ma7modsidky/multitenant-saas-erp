// .pnpmfile.cjs
// Pnpm hooks — used to patch transitive dependency versions for security fixes.
// In pnpm 11, the `pnpm.overrides` field in package.json is deprecated.
// This hook is the recommended replacement for overriding transitive dependency versions.
//
// See: https://pnpm.io/npmrc#hooks

'use strict';

module.exports = {
  hooks: {
    readPackage(pkg) {
      // Fix critical security advisory: @fastify/middie <9.3.2
      // GHSA-72c6-fx6q-fr5w — middleware authentication bypass in child plugin scopes
      if (pkg.name === '@nestjs/platform-fastify') {
        pkg.dependencies = pkg.dependencies || {};
        pkg.dependencies['@fastify/middie'] = '^9.3.2';
        pkg.dependencies['fastify'] = '^5.3.2';
      }
      return pkg;
    },
  },
};
