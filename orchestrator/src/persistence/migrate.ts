import { loadConfig } from '../config.js';
import { createLogger } from '../logger.js';
import { createDbPool } from './db.js';
import { runMigrations } from './migrationRunner.js';
import { MIGRATIONS } from './migrations/index.js';

/**
 * Evidence Store migration CLI (RFC §9.3). Run explicitly — via
 * `npm run migrate --workspace=@sherlock/orchestrator` or `make migrate` —
 * rather than implicitly on every process boot, so applying a schema
 * change is always a deliberate, observable, individually-loggable step,
 * not something that happens silently as a side effect of starting the
 * orchestrator.
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config);
  const pool = createDbPool(config.database);

  try {
    logger.info(
      { host: config.database.host, database: config.database.database },
      'applying Evidence Store migrations',
    );
    const applied = await runMigrations(pool, MIGRATIONS);
    if (applied.length === 0) {
      logger.info('no pending migrations — Evidence Store schema already up to date');
    } else {
      logger.info({ applied }, 'applied Evidence Store migrations');
    }
  } catch (error) {
    logger.error({ err: error }, 'failed to apply Evidence Store migrations');
    process.exitCode = 1;
  } finally {
    await pool.close();
  }
}

main();
