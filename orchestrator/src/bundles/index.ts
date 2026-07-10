/**
 * Public surface of the Bundle Adapters module (RFC §4; Plan §9 repository
 * structure `orchestrator/bundles/*`). Consumers (the Fusion Engine, M3+;
 * the vertical-slice wiring in this milestone) should import from this
 * barrel rather than reaching into individual bundle folders.
 */
export type { BundleAdapter, MakeEvidenceEventParams } from './types.js';
export { makeEvidenceEvent } from './types.js';

export type { AtsClient, IdentityClaimRecord, ObservedIdentityClaim } from './claim/index.js';
export {
  AtsClientError,
  AtsRecordNotFoundError,
  ClaimBundleAdapter,
  InMemoryAtsClient,
} from './claim/index.js';

export type { SessionJoinMetadata } from './metadata/index.js';
export { MetadataBundleAdapter } from './metadata/index.js';

export { EmbeddingSelfConsistencyTracker } from './embeddingSelfConsistency.js';
export type { SelfConsistencyObservation } from './embeddingSelfConsistency.js';

export { extractContradictionSignal } from './changePointSignal.js';

export type { VisualBundleInput } from './visual/index.js';
export { VisualBundleAdapter } from './visual/index.js';

export type { AudioBundleInput } from './audio/index.js';
export { AudioBundleAdapter } from './audio/index.js';

export type { DeviceBundleInput } from './device/index.js';
export { DeviceBundleAdapter } from './device/index.js';

export type { ElicitationBundleInput } from './elicitation/index.js';
export { ElicitationBundleAdapter } from './elicitation/index.js';

export type { LinguisticBundleInput, ObservedBiographicalClaim } from './linguistic/index.js';
export { LinguisticBundleAdapter } from './linguistic/index.js';
