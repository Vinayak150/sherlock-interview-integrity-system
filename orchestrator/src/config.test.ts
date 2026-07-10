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

describe('loadConfig — database (RFC §9.3 Evidence Store, ADR-7)', () => {
  it('falls back to the docker-compose local-dev defaults when env is empty', () => {
    const config = loadConfig({});

    expect(config.database).toEqual({
      host: 'localhost',
      port: 5432,
      database: 'sherlock',
      user: 'sherlock',
      password: 'sherlock_dev_password',
    });
  });

  it('respects explicit POSTGRES_* environment variables', () => {
    const config = loadConfig({
      POSTGRES_HOST: 'db.internal',
      POSTGRES_PORT: '6543',
      POSTGRES_DB: 'sherlock_prod',
      POSTGRES_USER: 'sherlock_app',
      POSTGRES_PASSWORD: 'super-secret',
    });

    expect(config.database).toEqual({
      host: 'db.internal',
      port: 6543,
      database: 'sherlock_prod',
      user: 'sherlock_app',
      password: 'super-secret',
    });
  });

  it('falls back to the default port on a non-numeric POSTGRES_PORT', () => {
    const config = loadConfig({ POSTGRES_PORT: 'not-a-port' });

    expect(config.database.port).toBe(5432);
  });

  it('falls back to the default port on an out-of-range POSTGRES_PORT', () => {
    expect(loadConfig({ POSTGRES_PORT: '0' }).database.port).toBe(5432);
    expect(loadConfig({ POSTGRES_PORT: '70000' }).database.port).toBe(5432);
    expect(loadConfig({ POSTGRES_PORT: '-1' }).database.port).toBe(5432);
  });

  it('falls back to the default port on an empty POSTGRES_PORT', () => {
    expect(loadConfig({ POSTGRES_PORT: '' }).database.port).toBe(5432);
    expect(loadConfig({ POSTGRES_PORT: '   ' }).database.port).toBe(5432);
  });

  it('falls back to the default host on an empty POSTGRES_HOST', () => {
    expect(loadConfig({ POSTGRES_HOST: '' }).database.host).toBe('localhost');
  });
});
