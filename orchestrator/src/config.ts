import 'dotenv/config';

/**
 * Environment management for the orchestrator deployable (RFC §9.2).
 *
 * M1 adds `DatabaseConfig`: the Evidence Store (RFC §9.3, ADR-7) is the
 * first real infrastructure dependency the orchestrator has, so this is the
 * milestone that gives it a typed, validated home. Session-registry (M7)
 * and model-serving-client (M8) configuration arrive with the milestones
 * that need them, per the same rationale.
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
}

export interface OrchestratorConfig {
  readonly nodeEnv: NodeEnv;
  readonly logLevel: string;
  readonly serviceName: string;
  readonly database: DatabaseConfig;
}

const DEFAULT_POSTGRES_PORT = 5432;
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
  };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): OrchestratorConfig {
  return {
    nodeEnv: readNodeEnv(env.NODE_ENV),
    logLevel: env.LOG_LEVEL ?? 'info',
    serviceName: env.ORCHESTRATOR_SERVICE_NAME ?? 'orchestrator',
    database: loadDatabaseConfig(env),
  };
}
