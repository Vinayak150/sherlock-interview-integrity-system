import { Writable } from 'node:stream';

import pino from 'pino';
import { describe, expect, it } from 'vitest';

import { AiMetricsRecorder, createAiMetricRecord } from './aiMetricsRecorder.js';
import { METRIC_MODEL_VERSION, OBSERVABILITY_LOG_MESSAGE } from './metricNames.js';

describe('AiMetricsRecorder', () => {
  it('writes structured observability payloads suitable for Prometheus/OpenTelemetry export', () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        lines.push(chunk.toString());
        callback();
      },
    });
    const logger = pino({ level: 'info' }, stream);
    const recorder = new AiMetricsRecorder(logger);

    recorder.record(
      createAiMetricRecord(
        METRIC_MODEL_VERSION,
        'info',
        1,
        { component: 'fusion', version: 'phase-1' },
        new Date('2026-07-10T12:00:00.000Z'),
      ),
    );

    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0] as string) as {
      msg: string;
      observability: {
        metricName: string;
        metricType: string;
        value: number;
        labels: Record<string, string>;
      };
    };
    expect(parsed.msg).toBe(OBSERVABILITY_LOG_MESSAGE);
    expect(parsed.observability.metricName).toBe(METRIC_MODEL_VERSION);
    expect(parsed.observability.metricType).toBe('info');
    expect(parsed.observability.labels.version).toBe('phase-1');
  });
});
