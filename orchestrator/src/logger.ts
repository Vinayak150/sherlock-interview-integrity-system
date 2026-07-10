import pino from 'pino';

import type { OrchestratorConfig } from './config.js';

/**
 * Structured logging for the orchestrator deployable.
 *
 * Deliberately generic and content-free at M0: this is transport/format
 * configuration only. Any future signal-health, evidence, or lifecycle
 * logging must go through this shared logger rather than console.* so that
 * log level, format, and (later) redaction policy stay centrally governed.
 */
export function createLogger(config: OrchestratorConfig) {
  return pino({
    name: config.serviceName,
    level: config.logLevel,
    formatters: {
      level(label) {
        return { level: label };
      },
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}

export type Logger = ReturnType<typeof createLogger>;
