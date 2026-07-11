/**
 * Public surface of the Model-Serving RPC client module (RFC §9.2/§9.6,
 * §12; Plan §9 repository structure `orchestrator/modelserving_client/`).
 */
export {
  ModelServingLivenessError,
  ModelServingNoFaceError,
  ModelServingNoSpeechError,
  ModelServingUnavailableError,
  ModelServingValidationError,
} from './errors.js';

export type { EmbeddingResult, LivenessResult } from './types.js';

export type { ModelServingClient, ModelServingClientOptions } from './modelServingClient.js';
export { HttpModelServingClient } from './modelServingClient.js';

export type {
  SamplingCadenceDecision,
  SamplingCadenceInput,
  SamplingCadenceOptions,
} from './samplingCadence.js';
export {
  DEFAULT_BASELINE_INTERVAL_MS,
  DEFAULT_BORDERLINE_INTERVAL_MS,
  DEFAULT_STABLE_INTERVAL_MS,
  DEFAULT_STABLE_MAX_INTERVAL_WIDTH,
  DEFAULT_UNSTABLE_MIN_INTERVAL_WIDTH,
  computeSamplingCadence,
} from './samplingCadence.js';
