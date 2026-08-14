import { z } from 'zod';

// ─── Shared ────────────────────────────────────────────────────────────────

const nodeEnvSchema = z.enum(['development', 'test', 'production']);

const urlSchema = z.string().url();

const localeSchema = z.string().min(2).max(5);

// ─── Backend environment variables ────────────────────────────────────────

export const backendEnvSchema = z.object({
  NODE_ENV: nodeEnvSchema.default('development'),

  PORT: z.coerce.number().int().positive().default(4000),
  API_BASE_URL: urlSchema,
  WEB_BASE_URL: urlSchema,

  // Database
  DATABASE_URL: z.string().min(1),
  DATABASE_MIGRATION_URL: z.string().min(1),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),

  // Redis
  REDIS_URL: z.string().min(1),

  // JWT
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('30d'),

  // Stripe
  STRIPE_SECRET_KEY: z.string().min(1),
  STRIPE_WEBHOOK_SECRET: z.string().min(1),

  // Email (Resend)
  RESEND_API_KEY: z.string().min(1),
  EMAIL_FROM: z.string().email(),

  // File storage (Cloudflare R2)
  R2_ACCOUNT_ID: z.string().min(1),
  R2_ACCESS_KEY_ID: z.string().min(1),
  R2_SECRET_ACCESS_KEY: z.string().min(1),
  R2_BUCKET: z.string().min(1),

  // FX rates
  FX_RATES_PROVIDER_URL: z.string().url(),
  FX_RATES_API_KEY: z.string().min(1),

  // Observability
  SENTRY_DSN: z.string().optional(),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional(),

  // Logging
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),

  // Locale
  DEFAULT_LOCALE: localeSchema.default('en'),
  SUPPORTED_LOCALES: z.string().default('en,ar,fr,es'),
  TRIAL_DURATION_DAYS: z.coerce.number().int().positive().default(14),

  // Platform administration
  // Comma-separated emails of accounts granted platform-admin access
  // (core_users.is_platform_admin is synced from this at boot). Empty by
  // default — the admin console is disabled until an admin is configured.
  PLATFORM_ADMIN_EMAILS: z.string().default(''),
});

export type BackendEnv = z.infer<typeof backendEnvSchema>;

// ─── Frontend environment variables ────────────────────────────────────────

export const frontendEnvSchema = z.object({
  NEXT_PUBLIC_API_BASE_URL: urlSchema,
  NEXT_PUBLIC_APP_URL: urlSchema,
  NEXT_PUBLIC_POSTHOG_KEY: z.string().optional(),
  NEXT_PUBLIC_SENTRY_DSN: z.string().optional(),
});

export type FrontendEnv = z.infer<typeof frontendEnvSchema>;
