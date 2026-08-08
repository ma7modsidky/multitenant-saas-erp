// next-build.cjs — runs `next build` with NODE_ENV forced to production.
//
// `next build` only sets NODE_ENV=production when it is not already set. When
// the ambient environment carries NODE_ENV=development (Windows dev machines
// that source the repo .env, or any polluted CI runner), Next keeps
// `development` and the known pages-runtime bug fires during the app-router
// build: "Error: <Html> should not be imported outside of pages/_document"
// while prerendering /404 and /_error (vercel/next.js#56481, #57277). This
// wrapper makes the production build deterministic everywhere, without a
// cross-env dependency (plain node, works on cmd/sh/PowerShell).
//
// Use `pnpm --filter web build` (or turbo's build) — running `npx next build`
// directly on a machine with a polluted NODE_ENV still hits the bug.
'use strict';

process.env.NODE_ENV = 'production';

const { spawn } = require('node:child_process');

// Resolve `next` through the shell on Windows (node_modules/.bin is on the
// script PATH); on POSIX, spawn resolves it directly. Known trade-off of the
// Windows shell path: Ctrl+C kills the cmd wrapper, not the next child —
// acceptable for a CI/local build command.
const child = spawn('next', ['build'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

let finished = false;

child.on('exit', (code) => {
  // On spawn failure both 'error' and 'exit' (code === null) fire — exit once.
  if (finished) return;
  finished = true;
  process.exit(code ?? 1);
});

child.on('error', (error) => {
  if (finished) return;
  finished = true;
  process.stderr.write(`[next-build] failed to spawn next build: ${String(error)}\n`);
  process.exit(1);
});
