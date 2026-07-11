import type { Logger } from '../logger.js';
import { OBSERVABILITY_LOG_MESSAGE } from './metricNames.js';
import { buildSessionMetrics, type SessionMetricsInput } from './sessionMetrics.js';
import type { AiMetricRecord, ObservabilityPayload } from './types.js';

function toPayload(record: AiMetricRecord): ObservabilityPayload {
  return {
    schemaVersion: record.schemaVersion,
    metricName: record.metricName,
    metricType: record.metricType,
    value: record.value,
    labels: record.labels,
    observedAt: record.observedAt,
  };
}

export class AiMetricsRecorder {
  constructor(private readonly logger: Logger) {}

  record(metric: AiMetricRecord): void {
    this.logger.info({ observability: toPayload(metric) }, OBSERVABILITY_LOG_MESSAGE);
  }

  recordSessionMetrics(input: SessionMetricsInput): void {
    for (const metric of buildSessionMetrics(input)) {
      this.record(metric);
    }
  }
}

export function createAiMetricRecord(
  metricName: string,
  metricType: AiMetricRecord['metricType'],
  value: number | boolean,
  labels: AiMetricRecord['labels'],
  observedAt: Date = new Date(),
): AiMetricRecord {
  return {
    schemaVersion: '1',
    metricName,
    metricType,
    value,
    labels,
    observedAt: observedAt.toISOString(),
  };
}
