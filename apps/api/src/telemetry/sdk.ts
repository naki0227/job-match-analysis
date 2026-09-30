import { diag, metrics, type DiagLogger } from "@opentelemetry/api";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  MeterProvider,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import {
  BatchSpanProcessor,
  NodeTracerProvider,
} from "@opentelemetry/sdk-trace-node";

export type TelemetryHandle = { shutdown: () => Promise<void> };

const noopHandle: TelemetryHandle = { shutdown: async () => {} };

/** Exporter errors are dropped: telemetry must never stop the service. */
const silentDiag: DiagLogger = {
  error: () => {},
  warn: () => {},
  info: () => {},
  debug: () => {},
  verbose: () => {},
};

/**
 * Registers the official OpenTelemetry SDK with OTLP/HTTP exporters. The
 * backend (currently Grafana Cloud, ADR-041) comes only from the standard
 * OTEL_EXPORTER_OTLP_ENDPOINT / OTEL_EXPORTER_OTLP_HEADERS variables; without
 * an endpoint nothing is registered and instruments stay no-op. Call before
 * creating instruments, because metric instruments bind to the provider
 * registered at creation time.
 */
export function startTelemetry(
  serviceName: string,
  env: NodeJS.ProcessEnv = process.env,
): TelemetryHandle {
  if (!env.OTEL_EXPORTER_OTLP_ENDPOINT) return noopHandle;
  diag.setLogger(silentDiag);
  const resource = resourceFromAttributes({
    "service.name": env.OTEL_SERVICE_NAME || serviceName,
    "deployment.environment.name": env.DEPLOYMENT_ENVIRONMENT || "production",
  });
  const tracerProvider = new NodeTracerProvider({
    resource,
    spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter())],
  });
  tracerProvider.register();
  const intervalMs = Number(env.OTEL_METRIC_EXPORT_INTERVAL) || 60_000;
  const meterProvider = new MeterProvider({
    resource,
    readers: [
      new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter(),
        exportIntervalMillis: intervalMs,
      }),
    ],
  });
  metrics.setGlobalMeterProvider(meterProvider);
  return {
    async shutdown() {
      // Flush what we can within a bound; a dead backend must not hang exit.
      await Promise.race([
        Promise.allSettled([
          tracerProvider.shutdown(),
          meterProvider.shutdown(),
        ]),
        new Promise((resolve) => setTimeout(resolve, 5_000).unref()),
      ]);
    },
  };
}
