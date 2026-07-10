import { describe, expect, it } from 'vitest';

import { loadConfig } from './config.js';
import { createLogger } from './logger.js';

describe('createLogger', () => {
  it('creates a logger bound to the configured service name and level', () => {
    const config = loadConfig({
      ORCHESTRATOR_SERVICE_NAME: 'orchestrator-test',
      LOG_LEVEL: 'debug',
    });
    const logger = createLogger(config);

    expect(logger.level).toBe('debug');
    expect(logger.bindings().name).toBe('orchestrator-test');
  });
});
