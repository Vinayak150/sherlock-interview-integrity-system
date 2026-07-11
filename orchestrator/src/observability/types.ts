/**
 * Structured AI observability records. Field names follow a stable schema so
 * log shippers can map them to Prometheus counters/histograms or OpenTelemetry
 * metrics without changing application code.
 */
export type MetricType = 'counter' | 'gauge' | 'histogram' | 'info';

export interface AiMetricLabels {
  readonly [key: string]: string | number | boolean;
}

export interface AiMetricRecord {
  readonly schemaVersion: '1';
  readonly metricName: string;
  readonly metricType: MetricType;
  readonly value: number | boolean;
  readonly labels: AiMetricLabels;
  readonly observedAt: string;
}

export interface ObservabilityPayload {
  readonly schemaVersion: '1';
  readonly metricName: string;
  readonly metricType: MetricType;
  readonly value: number | boolean;
  readonly labels: AiMetricLabels;
  readonly observedAt: string;
}
