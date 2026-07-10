/**
 * Public surface of the Fusion Engine module (RFC §5, ADR-1; Plan §9
 * repository structure `orchestrator/fusion/`).
 */
export { logGamma, regularizedIncompleteBeta, betaQuantile, betaCredibleInterval } from './beta.js';
export type { BetaCredibleInterval } from './beta.js';

export { DEFAULT_HALF_LIFE_MS, decayWeight } from './decay.js';

export { resolveSignalOutcome, signalLogLikelihoodRatio } from './likelihoodRatios.js';

export { DEFAULT_LOG_LR_CLAMP, clampLogLikelihoodRatio } from './logLikelihoodRatioClamp.js';

export { cosineSimilarity } from './similarity.js';

export type {
  ChangePointDetectorOptions,
  ChangePointDetectorState,
  ChangePointObservation,
} from './changePointDetector.js';
export {
  ChangePointDetector,
  DEFAULT_CONTROL_LIMIT,
  DEFAULT_SLACK,
  DEFAULT_TARGET_SIMILARITY,
  INITIAL_CHANGE_POINT_STATE,
  observeChangePoint,
} from './changePointDetector.js';

export { FusionEngine } from './fusionEngine.js';
export type { FusionEngineOptions } from './fusionEngine.js';

export type {
  BetaParameters,
  BundleContribution,
  CredibleInterval,
  FusionPosterior,
  LikelihoodRatioSpec,
  OutcomeExtractor,
  SignalOutcome,
} from './types.js';
