/**
 * OpenTelemetry initialization — called at the top of main.ts BEFORE
 * NestFactory.create() to ensure distributed tracing captures the full
 * request lifecycle.
 *
 * This module conditionally initializes the OpenTelemetry Node.js SDK
 * using dynamic imports. If OTEL_EXPORTER_OTLP_ENDPOINT is not configured,
 * tracing is disabled to keep the dev experience lightweight.
 *
 * Dynamic imports are used instead of static imports so that the heavy
 * OpenTelemetry packages are only loaded when tracing is configured.
 * This avoids bloating the production bundle for deployments that
 * don't use OTLP exporting.
 *
 * @see TECH_STACK.md — OpenTelemetry → OTLP collector
 * @see ARCHITECTURE.md §3 — core/observability
 */

/**
 * Initialize OpenTelemetry tracing if OTEL_EXPORTER_OTLP_ENDPOINT is set.
 *
 * Call this as early as possible in bootstrap():
 *
 * ```typescript
 * import { initializeTelemetry } from './core/observability/opentelemetry.setup.js';
 * initializeTelemetry();
 * ```
 */
export async function initializeTelemetry(): Promise<void> {
  const otlpEndpoint = process.env['OTEL_EXPORTER_OTLP_ENDPOINT'];

  if (!otlpEndpoint) {
    return;
  }

  try {
    // Dynamic imports — only loaded when OTLP is configured
    const { NodeSDK } = await import('@opentelemetry/sdk-node');
    const { getNodeAutoInstrumentations } = await import('@opentelemetry/auto-instrumentations-node');
    const { OTLPTraceExporter } = await import('@opentelemetry/exporter-trace-otlp-http');
    const { Resource } = await import('@opentelemetry/resources');
    const { SEMRESATTRS_SERVICE_NAME, SEMRESATTRS_DEPLOYMENT_ENVIRONMENT } =
      await import('@opentelemetry/semantic-conventions');

    const serviceName = process.env['OTEL_SERVICE_NAME'] || 'modubiz-api';
    const env = process.env['NODE_ENV'] || 'development';

    const sdk = new NodeSDK({
      resource: new Resource({
        [SEMRESATTRS_SERVICE_NAME]: serviceName,
        [SEMRESATTRS_DEPLOYMENT_ENVIRONMENT]: env,
      }),
      traceExporter: new OTLPTraceExporter({
        url: otlpEndpoint,
      }),
      instrumentations: [
        getNodeAutoInstrumentations({
          // Disable noisy instrumentations
          '@opentelemetry/instrumentation-fs': { enabled: false },
          '@opentelemetry/instrumentation-dns': { enabled: false },
          '@opentelemetry/instrumentation-net': { enabled: false },
        }),
      ],
    });

    sdk.start();

    // Graceful shutdown
    process.on('SIGTERM', () => {
      void sdk.shutdown();
    });
  } catch (err) {
    console.error('Failed to initialize OpenTelemetry SDK:', err);
  }
}
