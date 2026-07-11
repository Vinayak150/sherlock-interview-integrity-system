import { randomUUID } from 'node:crypto';

import 'dotenv/config';

import type { CalibrationMethod, IsotonicKnot, PlattScalingParameters } from './calibration/types.js';

/**
 * Environment management for the orchestrator deployable (RFC §9.2).
 *
 * M1 added `DatabaseConfig`: the Evidence Store (RFC §9.3, ADR-7) is the
 * first real infrastructure dependency the orchestrator has, so that was
 * the milestone that gave it a typed, validated home.
 *
 * M7 adds `RedisConfig` (the Session Registry, RFC §9.4/ADR-8) and
 * `replicaId` (this process's own identity on the consistent-hash ring,
 * RFC §9.4). M8 adds `HttpConfig` (the API layer's listen address).
 * Model-serving-client configuration (Plan M8's own numbering — the
 * Model-Serving Layer, distinct from this document's "M8 — External
 * Interfaces/API Layer" per the batch this config change ships with)
 * arrives with the milestone that actually needs it.
 */

export type NodeEnv = 'development' | 'test' | 'production';

/**
 * Connection parameters for the Evidence Store (RFC §9.3): one relational
 * database holding the append-only evidence-events table and the
 * session-state-snapshots table. Discrete fields (not a single connection
 * string) to match the `POSTGRES_*` variables already documented in
 * `.env.example`.
 */
export interface DatabaseConfig {
  readonly host: string;
  readonly port: number;
  readonly database: string;
  readonly user: string;
  readonly password: string;
  /** RFC §15/Pilot-readiness bar; Plan M16: encryption in transit for the Evidence Store connection. Defaults to `false` for local `docker-compose` development (a same-host Postgres container has no network hop worth encrypting); a real deployment sets `POSTGRES_SSL=true`. */
  readonly ssl: boolean;
}

/** Connection parameters for the Session Registry (RFC §9.4, ADR-8). */
export interface RedisConfig {
  readonly url: string;
}

/** The API layer's (Plan M8, this batch) listen address. */
export interface HttpConfig {
  readonly port: number;
  readonly host: string;
}

/** The Model-Serving Layer's base URL (RFC §9.2/§9.6; Plan M8/M9). */
export interface ModelServingConfig {
  readonly baseUrl: string;
}

/**
 * The Privacy & Compliance Layer's configuration (RFC §15/Pilot-readiness
 * bar; Plan M16). `fieldEncryptionKey` is the symmetric key
 * `security/fieldEncryption.ts` uses for biometric-derivative encryption
 * at rest -- a fixed local-dev default is provided so the stack still
 * runs out of the box, exactly like every other `*_dev_password`-style
 * default in this config module; a real deployment must override it.
 * `dataResidencyRegion` is informational/config-level only (Plan M16's
 * own stated scope) — no multi-region storage routing is implemented.
 */
export interface SecurityConfig {
  readonly fieldEncryptionKey: string;
  readonly dataResidencyRegion: string;
}

/** Optional post-fusion confidence calibration (RFC §14/§16). */
export interface ConfidenceCalibrationConfig {
  readonly enabled: boolean;
  readonly method: CalibrationMethod;
  readonly platt: PlattScalingParameters;
  readonly isotonicKnots: readonly IsotonicKnot[];
}

export interface OrchestratorConfig {
  readonly nodeEnv: NodeEnv;
  readonly logLevel: string;
  readonly serviceName: string;
  readonly database: DatabaseConfig;
  readonly redis: RedisConfig;
  readonly http: HttpConfig;
  readonly modelServing: ModelServingConfig;
  /** This process's own identity on the consistent-hash ring (RFC §9.4) — falls back to a random UUID per process start when unset, since no real multi-replica deployment exists yet to assign one deliberately. */
  readonly replicaId: string;
  readonly security: SecurityConfig;
  readonly confidenceCalibration: ConfidenceCalibrationConfig;
}

const DEFAULT_POSTGRES_PORT = 5432;
const DEFAULT_HTTP_PORT = 8080;
const MIN_TCP_PORT = 1;
const MAX_TCP_PORT = 65_535;

function readNodeEnv(raw: string | undefined): NodeEnv {
  if (raw === 'production' || raw === 'test' || raw === 'development') {
    return raw;
  }
  return 'development';
}

/**
 * Parses a TCP port from an environment variable, falling back to a safe
 * default for anything missing, empty, non-numeric, or out of the valid
 * port range — never throwing on malformed input, per the requirement that
 * configuration loading degrade to a safe default rather than crash the
 * process on a bad environment variable.
 */
function readPort(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < MIN_TCP_PORT || parsed > MAX_TCP_PORT) {
    return fallback;
  }
  return parsed;
}

function readNonEmpty(raw: string | undefined, fallback: string): string {
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  return raw;
}

function loadDatabaseConfig(env: NodeJS.ProcessEnv): DatabaseConfig {
  return {
    host: readNonEmpty(env.POSTGRES_HOST, 'localhost'),
    port: readPort(env.POSTGRES_PORT, DEFAULT_POSTGRES_PORT),
    database: readNonEmpty(env.POSTGRES_DB, 'sherlock'),
    user: readNonEmpty(env.POSTGRES_USER, 'sherlock'),
    password: readNonEmpty(env.POSTGRES_PASSWORD, 'sherlock_dev_password'),
    ssl: env.POSTGRES_SSL === 'true',
  };
}

function loadRedisConfig(env: NodeJS.ProcessEnv): RedisConfig {
  return { url: readNonEmpty(env.REDIS_URL, 'redis://localhost:6379') };
}

function loadHttpConfig(env: NodeJS.ProcessEnv): HttpConfig {
  return {
    port: readPort(env.PORT ?? env.ORCHESTRATOR_HTTP_PORT, DEFAULT_HTTP_PORT),
    host: readNonEmpty(env.ORCHESTRATOR_HTTP_HOST, '0.0.0.0'),
  };
}

function loadModelServingConfig(env: NodeJS.ProcessEnv): ModelServingConfig {
  return { baseUrl: readNonEmpty(env.MODEL_SERVING_URL, 'http://localhost:8081') };
}

function loadSecurityConfig(env: NodeJS.ProcessEnv): SecurityConfig {
  return {
    fieldEncryptionKey: readNonEmpty(
      env.FIELD_ENCRYPTION_KEY,
      'sherlock_dev_field_encryption_key_32_bytes!!',
    ),
    dataResidencyRegion: readNonEmpty(env.DATA_RESIDENCY_REGION, 'us'),
  };
}

function readBoolean(raw: string | undefined, fallback = false): boolean {
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  return raw.trim().toLowerCase() === 'true';
}

function readNumber(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readCalibrationMethod(raw: string | undefined): CalibrationMethod {
  return raw === 'isotonic' ? 'isotonic' : 'platt';
}

function loadConfidenceCalibrationConfig(env: NodeJS.ProcessEnv): ConfidenceCalibrationConfig {
  const defaultKnots: readonly IsotonicKnot[] = [
    { x: 0, y: 0 },
    { x: 0.25, y: 0.25 },
    { x: 0.5, y: 0.5 },
    { x: 0.75, y: 0.75 },
    { x: 1, y: 1 },
  ];

  let isotonicKnots = defaultKnots;
  const knotsJson = env.CONFIDENCE_CALIBRATION_ISOTONIC_KNOTS;
  if (knotsJson !== undefined && knotsJson.trim() !== '') {
    try {
      const parsed = JSON.parse(knotsJson) as unknown;
      if (
        Array.isArray(parsed) &&
        parsed.every(
          (entry) =>
            typeof entry === 'object' &&
            entry !== null &&
            typeof (entry as { x?: unknown }).x === 'number' &&
            typeof (entry as { y?: unknown }).y === 'number',
        )
      ) {
        isotonicKnots = parsed as IsotonicKnot[];
      }
    } catch {
      isotonicKnots = defaultKnots;
    }
  }

  return {
    enabled: readBoolean(env.CONFIDENCE_CALIBRATION_ENABLED, false),
    method: readCalibrationMethod(env.CONFIDENCE_CALIBRATION_METHOD),
    platt: {
      a: readNumber(env.CONFIDENCE_CALIBRATION_PLATT_A, 1),
      b: readNumber(env.CONFIDENCE_CALIBRATION_PLATT_B, 0),
    },
    isotonicKnots,
  };
}

function loadReplicaId(env: NodeJS.ProcessEnv): string {
  return env.ORCHESTRATOR_REPLICA_ID === undefined || env.ORCHESTRATOR_REPLICA_ID.trim() === ''
    ? randomUUID()
    : env.ORCHESTRATOR_REPLICA_ID;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): OrchestratorConfig {
  return {
    nodeEnv: readNodeEnv(env.NODE_ENV),
    logLevel: env.LOG_LEVEL ?? 'info',
    serviceName: env.ORCHESTRATOR_SERVICE_NAME ?? 'orchestrator',
    database: loadDatabaseConfig(env),
    redis: loadRedisConfig(env),
    http: loadHttpConfig(env),
    modelServing: loadModelServingConfig(env),
    replicaId: loadReplicaId(env),
    security: loadSecurityConfig(env),
    confidenceCalibration: loadConfidenceCalibrationConfig(env),
  };
}
