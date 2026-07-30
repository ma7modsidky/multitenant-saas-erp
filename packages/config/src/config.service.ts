import { backendEnvSchema, frontendEnvSchema, type BackendEnv, type FrontendEnv } from './config.schema.js';

/**
 * ConfigService
 *
 * The ONLY place in the application that reads process.env.
 * All other code must use this service to access configuration.
 *
 * Validates environment variables at boot using Zod schemas.
 * The application must refuse to start if validation fails.
 *
 * @see TECH_STACK.md §5 - Environment variables
 * @see CODING_STANDARDS.md §11 - process.env must only be read here
 */
export class ConfigService {
  private readonly backend: BackendEnv;
  private readonly frontend?: FrontendEnv;

  constructor(env: Record<string, string | undefined> = process.env) {
    const backendResult = backendEnvSchema.safeParse(env);

    if (!backendResult.success) {
      const errors = backendResult.error.flatten();
      const message = [
        '❌ Invalid backend environment variables:',
        ...Object.entries(errors.fieldErrors).map(([key, msgs]) => `  ${key}: ${msgs?.join(', ') ?? 'missing'}`),
        ...(errors.formErrors.length > 0
          ? ['  _form: ' + errors.formErrors.join('; ')]
          : []),
      ].join('\n');
      throw new Error(message);
    }

    this.backend = backendResult.data;

    // Frontend env vars are optional (only validated in web context)
    const frontendResult = frontendEnvSchema.safeParse(env);
    if (frontendResult.success) {
      this.frontend = frontendResult.data;
    }
  }

  // ─── Backend config getters ──────────────────────────────────────────────

  get nodeEnv(): BackendEnv['NODE_ENV'] {
    return this.backend.NODE_ENV;
  }

  get isDev(): boolean {
    return this.backend.NODE_ENV === 'development';
  }

  get isProd(): boolean {
    return this.backend.NODE_ENV === 'production';
  }

  get isTest(): boolean {
    return this.backend.NODE_ENV === 'test';
  }

  get port(): number {
    return this.backend.PORT;
  }

  get apiBaseUrl(): string {
    return this.backend.API_BASE_URL;
  }

  get webBaseUrl(): string {
    return this.backend.WEB_BASE_URL;
  }

  // Database
  get databaseUrl(): string {
    return this.backend.DATABASE_URL;
  }

  get databaseMigrationUrl(): string {
    return this.backend.DATABASE_MIGRATION_URL;
  }

  get databasePoolMax(): number {
    return this.backend.DATABASE_POOL_MAX;
  }

  // Redis
  get redisUrl(): string {
    return this.backend.REDIS_URL;
  }

  // JWT
  get jwtAccessSecret(): string {
    return this.backend.JWT_ACCESS_SECRET;
  }

  get jwtRefreshSecret(): string {
    return this.backend.JWT_REFRESH_SECRET;
  }

  get jwtAccessTtl(): string {
    return this.backend.JWT_ACCESS_TTL;
  }

  get jwtRefreshTtl(): string {
    return this.backend.JWT_REFRESH_TTL;
  }

  // Stripe
  get stripeSecretKey(): string {
    return this.backend.STRIPE_SECRET_KEY;
  }

  get stripeWebhookSecret(): string {
    return this.backend.STRIPE_WEBHOOK_SECRET;
  }

  // Email
  get resendApiKey(): string {
    return this.backend.RESEND_API_KEY;
  }

  get emailFrom(): string {
    return this.backend.EMAIL_FROM;
  }

  // R2 / Storage
  get r2AccountId(): string {
    return this.backend.R2_ACCOUNT_ID;
  }

  get r2AccessKeyId(): string {
    return this.backend.R2_ACCESS_KEY_ID;
  }

  get r2SecretAccessKey(): string {
    return this.backend.R2_SECRET_ACCESS_KEY;
  }

  get r2Bucket(): string {
    return this.backend.R2_BUCKET;
  }

  // FX rates
  get fxRatesProviderUrl(): string {
    return this.backend.FX_RATES_PROVIDER_URL;
  }

  get fxRatesApiKey(): string {
    return this.backend.FX_RATES_API_KEY;
  }

  // Observability
  get sentryDsn(): string | undefined {
    return this.backend.SENTRY_DSN;
  }

  get otelExporterOtlpEndpoint(): string | undefined {
    return this.backend.OTEL_EXPORTER_OTLP_ENDPOINT;
  }

  // Logging
  get logLevel(): string {
    return this.backend.LOG_LEVEL;
  }

  // Locale
  get defaultLocale(): string {
    return this.backend.DEFAULT_LOCALE;
  }

  get supportedLocales(): string[] {
    return this.backend.SUPPORTED_LOCALES.split(',').map((s) => s.trim());
  }

  get trialDurationDays(): number {
    return this.backend.TRIAL_DURATION_DAYS;
  }

  // ─── Frontend config getters ─────────────────────────────────────────────

  get nextPublicApiBaseUrl(): string | undefined {
    return this.frontend?.NEXT_PUBLIC_API_BASE_URL;
  }

  get nextPublicAppUrl(): string | undefined {
    return this.frontend?.NEXT_PUBLIC_APP_URL;
  }

  get nextPublicPosthogKey(): string | undefined {
    return this.frontend?.NEXT_PUBLIC_POSTHOG_KEY;
  }
}
