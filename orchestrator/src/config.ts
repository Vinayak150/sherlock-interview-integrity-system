import 'dotenv/config';

/**
 * Environment management for the orchestrator deployable (RFC §9.2).
 *
 * M0 scope: read and validate the small set of variables the process needs
 * to start and log correctly. No database, registry, or model-serving
 * client wiring belongs here yet — those arrive with the milestones that
 * need them (M1, M7, M8 respectively).
 */

export type NodeEnv = 'development' | 'test' | 'production';

export interface OrchestratorConfig {
  readonly nodeEnv: NodeEnv;
  readonly logLevel: string;
  readonly serviceName: string;
}

function readNodeEnv(raw: string | undefined): NodeEnv {
  if (raw === 'production' || raw === 'test' || raw === 'development') {
    return raw;
  }
  return 'development';
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): OrchestratorConfig {
  return {
    nodeEnv: readNodeEnv(env.NODE_ENV),
    logLevel: env.LOG_LEVEL ?? 'info',
    serviceName: env.ORCHESTRATOR_SERVICE_NAME ?? 'orchestrator',
  };
}
