import type { BundleName, NewEvidenceEvent, SignalHealthStatus } from '@sherlock/contracts';

/**
 * Shared shape for every Bundle Adapter (RFC §4; Plan §3 "Bundle Adapters",
 * §9 repository structure `orchestrator/bundles/*`).
 *
 * A Bundle Adapter's only job is normalizing raw, bundle-specific input
 * (platform events, an ATS record, a client-agent event, a model-serving
 * result — whichever this bundle's family needs) into signal-health-tagged
 * `EvidenceEvent`s (Plan §2 domain model). It never touches fusion math
 * (§5, M3) or lifecycle state (§6, M4) directly — those are downstream
 * consumers of what this interface produces.
 *
 * `TInput` is intentionally adapter-specific: the Claim adapter's input
 * (an `ObservedIdentityClaim`) and the Metadata adapter's input (a
 * `SessionJoinMetadata`) share nothing in shape, only this contract.
 */
export interface BundleAdapter<TInput> {
  readonly bundle: BundleName;
  buildEvidenceEvents(
    sessionId: string,
    input: TInput,
    occurredAt?: Date,
  ): readonly NewEvidenceEvent[] | Promise<readonly NewEvidenceEvent[]>;
}

export interface MakeEvidenceEventParams {
  readonly sessionId: string;
  readonly bundle: BundleName;
  readonly signalName: string;
  readonly healthStatus: SignalHealthStatus;
  readonly value: unknown;
  readonly occurredAt: Date;
}

/**
 * Builds a single `NewEvidenceEvent`, factoring out the session/bundle/
 * timestamp boilerplate every adapter would otherwise repeat. This does not
 * itself validate against `NewEvidenceEventSchema` — that happens for real
 * at the persistence boundary (M1, `EvidenceEventRepository.append`) — it
 * only guarantees adapters emit records that are shape-consistent with it.
 */
export function makeEvidenceEvent(params: MakeEvidenceEventParams): NewEvidenceEvent {
  return {
    sessionId: params.sessionId,
    bundle: params.bundle,
    signalName: params.signalName,
    healthStatus: params.healthStatus,
    value: params.value === undefined ? null : params.value,
    occurredAt: params.occurredAt,
    metadata: null,
  };
}
