import { CONTRACTS_PACKAGE_NAME } from '@sherlock/contracts';

import { loadConfig } from './config.js';
import { createLogger } from './logger.js';

/**
 * Orchestrator entrypoint — M0 scaffold.
 *
 * This deliberately does not stand up an HTTP/WebSocket API, a database
 * connection, or any bundle/fusion/state-machine module: those are explicit
 * non-goals for M0. Its only job is to prove the deployable starts, reads
 * its environment, and logs correctly — the foundation every later
 * milestone (M1+) builds on.
 */
function main(): void {
  const config = loadConfig();
  const logger = createLogger(config);

  logger.info(
    { nodeEnv: config.nodeEnv, contracts: CONTRACTS_PACKAGE_NAME },
    'orchestrator scaffold starting (M0 — no domain modules loaded)',
  );

  const heartbeat = setInterval(() => {
    logger.debug('orchestrator scaffold heartbeat');
  }, 30_000);

  const shutdown = (signal: string): void => {
    logger.info({ signal }, 'orchestrator scaffold shutting down');
    clearInterval(heartbeat);
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main();
