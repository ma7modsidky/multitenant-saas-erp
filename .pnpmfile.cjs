// .pnpmfile.cjs
// Pnpm hooks — used to patch transitive dependency versions for security fixes.
// In pnpm 11, the `pnpm.overrides` field in package.json is deprecated; its
// replacement is the `overrides` section in pnpm-workspace.yaml. Prefer that
// for simple version overrides. This hook is for rewrites the overrides syntax
// cannot express (e.g. bumping a consumer's declared range conditionally).
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

      // next pins postcss 8.4.31 exactly, which is in the vulnerable range
      // (GHSA-fxqj-rqcc-2cmp — postcss line breaks in selector parsing).
      if (pkg.name === 'next') {
        pkg.dependencies = pkg.dependencies || {};
        pkg.dependencies['postcss'] = '^8.5.26';
        // next pins sharp ^0.34.3, vulnerable via upstream libvips CVEs
        // (GHSA-f88m-g3jw-g9cj — patched in sharp 0.35.0).
        pkg.optionalDependencies = pkg.optionalDependencies || {};
        pkg.optionalDependencies['sharp'] = '^0.35.3';
      }

      // @nestjs/swagger pins js-yaml 5.2.1, which is in the vulnerable range
      // (arbitrary code execution via untrusted YAML — fixed in js-yaml 5.2.2).
      if (pkg.name === '@nestjs/swagger') {
        pkg.dependencies = pkg.dependencies || {};
        pkg.dependencies['js-yaml'] = '^5.2.3';
      }

      // fast-uri: ReDoS via infinite loop in URI validation (GHSA-7p8r-x3mc-p8w7).
      // Bump each consumer's declared range to the patched minor of its major line.
      if (pkg.name === 'ajv' && pkg.dependencies && pkg.dependencies['fast-uri']) {
        if (pkg.dependencies['fast-uri'].startsWith('^3.')) {
          pkg.dependencies['fast-uri'] = '^3.1.5';
        }
      }
      if (pkg.name === '@fastify/ajv-compiler' && pkg.dependencies && pkg.dependencies['fast-uri']) {
        if (pkg.dependencies['fast-uri'].startsWith('^3.')) {
          pkg.dependencies['fast-uri'] = '^3.1.5';
        } else if (pkg.dependencies['fast-uri'].startsWith('^4.')) {
          pkg.dependencies['fast-uri'] = '^4.1.2';
        }
      }
      // fast-json-stringify (fastify's serializer) pins fast-uri ^4.0.0.
      if (pkg.name === 'fast-json-stringify' && pkg.dependencies && pkg.dependencies['fast-uri']) {
        if (pkg.dependencies['fast-uri'].startsWith('^4.')) {
          pkg.dependencies['fast-uri'] = '^4.1.2';
        }
      }

      // brace-expansion: ReDoS in brace pattern parsing
      // (GHSA-mh99-v99m-4gvg / GHSA-rgw5-rvv9-x895). Each minimatch major
      // line needs its own patched brace-expansion release.
      if (pkg.name === 'minimatch' && pkg.dependencies && pkg.dependencies['brace-expansion']) {
        const cur = pkg.dependencies['brace-expansion'];
        if (cur.startsWith('^1.')) {
          pkg.dependencies['brace-expansion'] = '^1.1.18';
        } else if (cur.startsWith('^2.')) {
          pkg.dependencies['brace-expansion'] = '^2.1.4';
        } else if (cur.startsWith('^5.')) {
          pkg.dependencies['brace-expansion'] = '^5.0.9';
        }
      }

      // @eslint/eslintrc pins js-yaml 4.3.0, vulnerable to arbitrary code
      // execution (GHSA-5p4m-2wfm-xmqj). eslint 9.x is already at its latest
      // release, so override the transitive instead.
      if (pkg.name === '@eslint/eslintrc' && pkg.dependencies && pkg.dependencies['js-yaml']) {
        pkg.dependencies['js-yaml'] = '^4.3.1';
      }

      return pkg;
    },
  },
};
