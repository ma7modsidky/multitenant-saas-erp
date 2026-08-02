# ModuBiz API — Multi-stage Docker Build
#
# Runtime: distroless (nodejs22-debian12)
# Builder: node:22-slim
#
# Per TECH_STACK.md: distroless runtime for the API.
# Not yet used in production; scaffolded for Phase 7.

# ─── Stage 1: Install dependencies ─────────────────────────────────────────
FROM node:25-slim AS deps

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm@latest

# Copy only package files for dependency caching
COPY pnpm-lock.yaml ./
COPY pnpm-workspace.yaml ./
COPY package.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY packages/tsconfig/package.json ./packages/tsconfig/package.json
COPY packages/eslint-config/package.json ./packages/eslint-config/package.json
COPY packages/config/package.json ./packages/config/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
COPY packages/db/package.json ./packages/db/package.json
COPY packages/money/package.json ./packages/money/package.json
COPY packages/i18n/package.json ./packages/i18n/package.json
COPY packages/ui/package.json ./packages/ui/package.json
COPY packages/api-client/package.json ./packages/api-client/package.json

# Install dependencies (frozen lockfile ensures reproducibility)
RUN pnpm install --frozen-lockfile --prod

# ─── Stage 2: Build ────────────────────────────────────────────────────────
FROM node:25-slim AS builder

WORKDIR /app

RUN npm install -g pnpm@latest

# Copy everything
COPY . .

# Install all dependencies (including devDependencies)
RUN pnpm install --frozen-lockfile

# Build the API
RUN pnpm --filter api build

# Prune dev dependencies for production
RUN pnpm prune --prod

# ─── Stage 3: Runtime (distroless) ─────────────────────────────────────────
FROM gcr.io/distroless/nodejs22-debian12 AS runner

WORKDIR /app

# Copy only what's needed for runtime
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/pnpm-lock.yaml ./
COPY --from=builder /app/package.json ./

# Expose the API port
EXPOSE 4000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=30s --retries=3 \
  CMD ["node", "-e", "require('http').get('http://localhost:4000/health', (r) => { process.exit(r.statusCode === 200 ? 0 : 1) }).on('error', () => process.exit(1))"]

# Run the API
CMD ["apps/api/dist/main.js"]
