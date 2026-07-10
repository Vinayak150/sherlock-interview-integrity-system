import type {
  JoinMethod,
  JoinMethodValue,
  MetadataConsistencyValue,
  MetadataDetectionValue,
  NewEvidenceEvent,
  ScreenShareState,
  ScreenShareStateValue,
} from '@sherlock/contracts';

import type { BundleAdapter } from '../types.js';
import { makeEvidenceEvent } from '../types.js';

/**
 * Raw session/platform metadata as observed at (or shortly after) join time
 * (RFC §4-B). Every field is nullable and independently so — this bundle is
 * explicitly Tier 2/supportive (§13): a session missing every one of these
 * fields is still fully assessable on the Claim bundle alone, and a field
 * being `null` here must never be treated as negative evidence (§7).
 */
export interface SessionJoinMetadata {
  readonly joinMethod: JoinMethod | null;
  readonly joinOrder: number | null;
  readonly observedIpCountry: string | null;
  readonly statedCountry: string | null;
  readonly observedDeviceFingerprint: string | null;
  readonly priorSessionDeviceFingerprint: string | null;
  readonly virtualCaptureDeviceDetected: boolean | null;
  readonly screenShareState: ScreenShareState | null;
  readonly multiMonitorDetected: boolean | null;
}

/**
 * Normalizes session/platform metadata signals (RFC §4-B) into
 * signal-health-tagged `EvidenceEvent`s. Unlike the Claim bundle, every
 * value here is already available on the join event itself — no external
 * lookup, hence a synchronous adapter. A `null` input field is reported
 * `NO_SIGNAL_DETECTED` (nothing observed), never coerced into a negative or
 * omitted outright (§13's signal-health contract).
 */
export class MetadataBundleAdapter implements BundleAdapter<SessionJoinMetadata> {
  readonly bundle = 'metadata' as const;

  buildEvidenceEvents(
    sessionId: string,
    input: SessionJoinMetadata,
    occurredAt: Date = new Date(),
  ): readonly NewEvidenceEvent[] {
    return [
      this.buildJoinMethodEvent(sessionId, input, occurredAt),
      this.buildConsistencyEvent(
        sessionId,
        'ip_geolocation_consistency',
        input.observedIpCountry,
        input.statedCountry,
        occurredAt,
      ),
      this.buildConsistencyEvent(
        sessionId,
        'device_fingerprint_continuity',
        input.observedDeviceFingerprint,
        input.priorSessionDeviceFingerprint,
        occurredAt,
      ),
      this.buildDetectionEvent(
        sessionId,
        'virtual_capture_device_detected',
        input.virtualCaptureDeviceDetected,
        occurredAt,
      ),
      this.buildScreenShareEvent(sessionId, input.screenShareState, occurredAt),
      this.buildDetectionEvent(
        sessionId,
        'multi_monitor_detected',
        input.multiMonitorDetected,
        occurredAt,
      ),
    ];
  }

  private buildJoinMethodEvent(
    sessionId: string,
    input: SessionJoinMetadata,
    occurredAt: Date,
  ): NewEvidenceEvent {
    if (input.joinMethod === null) {
      const value: JoinMethodValue = { method: 'unknown', joinOrder: input.joinOrder };
      return makeEvidenceEvent({
        sessionId,
        bundle: this.bundle,
        signalName: 'join_method',
        healthStatus: 'NO_SIGNAL_DETECTED',
        value,
        occurredAt,
      });
    }
    const value: JoinMethodValue = { method: input.joinMethod, joinOrder: input.joinOrder };
    return makeEvidenceEvent({
      sessionId,
      bundle: this.bundle,
      signalName: 'join_method',
      healthStatus: 'OK',
      value,
      occurredAt,
    });
  }

  /**
   * Shared by `ip_geolocation_consistency` and `device_fingerprint_continuity`
   * (RFC §4-B: both explicitly "weak," both a comparison of an observed
   * value against a stated/prior one). `consistent` stays `null` — not
   * `false` — whenever either side of the comparison is unavailable.
   */
  private buildConsistencyEvent(
    sessionId: string,
    signalName: 'ip_geolocation_consistency' | 'device_fingerprint_continuity',
    observedValue: string | null,
    statedValue: string | null,
    occurredAt: Date,
  ): NewEvidenceEvent {
    const bothPresent = observedValue !== null && statedValue !== null;
    const value: MetadataConsistencyValue = {
      consistent: bothPresent ? observedValue === statedValue : null,
      observedValue,
      statedValue,
    };
    return makeEvidenceEvent({
      sessionId,
      bundle: this.bundle,
      signalName,
      healthStatus: bothPresent ? 'OK' : 'NO_SIGNAL_DETECTED',
      value,
      occurredAt,
    });
  }

  /** Shared by `virtual_capture_device_detected` and `multi_monitor_detected`. */
  private buildDetectionEvent(
    sessionId: string,
    signalName: 'virtual_capture_device_detected' | 'multi_monitor_detected',
    detected: boolean | null,
    occurredAt: Date,
  ): NewEvidenceEvent {
    if (detected === null) {
      return makeEvidenceEvent({
        sessionId,
        bundle: this.bundle,
        signalName,
        healthStatus: 'NO_SIGNAL_DETECTED',
        value: null,
        occurredAt,
      });
    }
    const value: MetadataDetectionValue = { detected };
    return makeEvidenceEvent({
      sessionId,
      bundle: this.bundle,
      signalName,
      healthStatus: 'OK',
      value,
      occurredAt,
    });
  }

  private buildScreenShareEvent(
    sessionId: string,
    state: ScreenShareState | null,
    occurredAt: Date,
  ): NewEvidenceEvent {
    if (state === null) {
      return makeEvidenceEvent({
        sessionId,
        bundle: this.bundle,
        signalName: 'screen_share_state',
        healthStatus: 'NO_SIGNAL_DETECTED',
        value: null,
        occurredAt,
      });
    }
    const value: ScreenShareStateValue = { state };
    return makeEvidenceEvent({
      sessionId,
      bundle: this.bundle,
      signalName: 'screen_share_state',
      healthStatus: 'OK',
      value,
      occurredAt,
    });
  }
}
