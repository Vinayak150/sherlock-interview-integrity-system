import { describe, expect, it } from 'vitest';

import { loadConfig } from './config.js';

describe('loadConfig', () => {
  it('falls back to safe development defaults when env is empty', () => {
    const config = loadConfig({});

    expect(config.nodeEnv).toBe('development');
    expect(config.logLevel).toBe('info');
    expect(config.serviceName).toBe('orchestrator');
  });

  it('respects explicit environment variables', () => {
    const config = loadConfig({
      NODE_ENV: 'production',
      LOG_LEVEL: 'warn',
      ORCHESTRATOR_SERVICE_NAME: 'orchestrator-test',
    });

    expect(config.nodeEnv).toBe('production');
    expect(config.logLevel).toBe('warn');
    expect(config.serviceName).toBe('orchestrator-test');
  });

  it('rejects an unrecognized NODE_ENV value by falling back to development', () => {
    const config = loadConfig({ NODE_ENV: 'staging' });

    expect(config.nodeEnv).toBe('development');
  });
});
