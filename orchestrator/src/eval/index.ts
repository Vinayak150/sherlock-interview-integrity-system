/**
 * Public surface of the Evaluation Harness module (Plan M15). Offline
 * tooling only — nothing here is wired into the live request path;
 * `orchestrator/src/index.ts` never imports from this module.
 */
export type { ReplayResult, ReplayStep } from './replayRunner.js';
export { ReplayRunner } from './replayRunner.js';

export type { AblationResult } from './ablationRunner.js';
export { runAblation } from './ablationRunner.js';

export type { CalibrationSample } from './calibration.js';
export { computeExpectedCalibrationError } from './calibration.js';
