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
      ssl: false,
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
      ssl: false,
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

describe('loadConfig — redis (RFC §9.4 Session Registry, ADR-8; Plan M7)', () => {
  it('falls back to the docker-compose local-dev default when env is empty', () => {
    expect(loadConfig({}).redis).toEqual({ url: 'redis://localhost:6379' });
  });

  it('respects an explicit REDIS_URL', () => {
    expect(loadConfig({ REDIS_URL: 'redis://redis.internal:6380' }).redis).toEqual({
      url: 'redis://redis.internal:6380',
    });
  });

  it('falls back to the default on an empty REDIS_URL', () => {
    expect(loadConfig({ REDIS_URL: '' }).redis.url).toBe('redis://localhost:6379');
  });
});

describe('loadConfig — http (Plan M8, this batch)', () => {
  it('falls back to safe defaults when env is empty', () => {
    expect(loadConfig({}).http).toEqual({ port: 8080, host: '0.0.0.0' });
  });

  it('respects explicit ORCHESTRATOR_HTTP_* environment variables', () => {
    expect(
      loadConfig({ ORCHESTRATOR_HTTP_PORT: '9090', ORCHESTRATOR_HTTP_HOST: '127.0.0.1' }).http,
    ).toEqual({
      port: 9090,
      host: '127.0.0.1',
    });
  });

  it('falls back to the default port on a non-numeric ORCHESTRATOR_HTTP_PORT', () => {
    expect(loadConfig({ ORCHESTRATOR_HTTP_PORT: 'not-a-port' }).http.port).toBe(8080);
  });
});

describe('loadConfig — modelServing (RFC §9.2/§9.6; Plan M8/M9)', () => {
  it('falls back to the docker-compose local-dev default when env is empty', () => {
    expect(loadConfig({}).modelServing).toEqual({ baseUrl: 'http://localhost:8081' });
  });

  it('respects an explicit MODEL_SERVING_URL', () => {
    expect(
      loadConfig({ MODEL_SERVING_URL: 'http://model-serving.internal:8081' }).modelServing,
    ).toEqual({
      baseUrl: 'http://model-serving.internal:8081',
    });
  });
});

describe('loadConfig — database.ssl (RFC §15/Pilot-readiness bar; Plan M16)', () => {
  it('defaults to false (matching a local docker-compose Postgres)', () => {
    expect(loadConfig({}).database.ssl).toBe(false);
  });

  it('is true only when POSTGRES_SSL is exactly "true"', () => {
    expect(loadConfig({ POSTGRES_SSL: 'true' }).database.ssl).toBe(true);
    expect(loadConfig({ POSTGRES_SSL: 'yes' }).database.ssl).toBe(false);
    expect(loadConfig({ POSTGRES_SSL: '1' }).database.ssl).toBe(false);
  });
});

describe('loadConfig — security (RFC §15/Pilot-readiness bar; Plan M16)', () => {
  it('falls back to local-dev defaults when env is empty', () => {
    const security = loadConfig({}).security;
    expect(security.fieldEncryptionKey.length).toBeGreaterThan(0);
    expect(security.dataResidencyRegion).toBe('us');
  });

  it('respects explicit FIELD_ENCRYPTION_KEY and DATA_RESIDENCY_REGION', () => {
    const security = loadConfig({
      FIELD_ENCRYPTION_KEY: 'a-different-key',
      DATA_RESIDENCY_REGION: 'eu',
    }).security;
    expect(security.fieldEncryptionKey).toBe('a-different-key');
    expect(security.dataResidencyRegion).toBe('eu');
  });
});

describe('loadConfig — replicaId (RFC §9.4; Plan M7)', () => {
  it('respects an explicit ORCHESTRATOR_REPLICA_ID', () => {
    expect(loadConfig({ ORCHESTRATOR_REPLICA_ID: 'replica-42' }).replicaId).toBe('replica-42');
  });

  it('falls back to a generated identifier when unset, and it is non-empty', () => {
    const config = loadConfig({});
    expect(config.replicaId.length).toBeGreaterThan(0);
  });

  it('falls back to a generated identifier when set to an empty string', () => {
    const config = loadConfig({ ORCHESTRATOR_REPLICA_ID: '   ' });
    expect(config.replicaId.trim().length).toBeGreaterThan(0);
  });

  it('generates a different identifier on each call when unset (no accidental cross-process collision)', () => {
    const first = loadConfig({}).replicaId;
    const second = loadConfig({}).replicaId;
    expect(first).not.toBe(second);
  });
});
