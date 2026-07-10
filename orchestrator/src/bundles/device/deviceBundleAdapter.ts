import type {
  DeviceEventCountValue,
  DeviceSignalName,
  NewEvidenceEvent,
} from '@sherlock/contracts';

import type { BundleAdapter } from '../types.js';
import { makeEvidenceEvent } from '../types.js';

const DEVICE_SIGNAL_NAMES: readonly DeviceSignalName[] = [
  'tab_focus_change',
  'application_switch',
  'clipboard_paste',
  'keyboard_rhythm_anomaly',
];

/**
 * Client-agent-derived counts for one observation window (RFC §9.5:
 * "clipboard, active-tab/app-focus, keyboard-timing metadata, not
 * keystroke *content*"). Any count field is `null` when that particular
 * signal was not observed this window — distinct from `0` (observed, and
 * nothing happened).
 *
 * `consentGranted` gates the whole bundle: RFC §9.5's Committee Note is
 * explicit that "a candidate declining this specific permission must not
 * be treated as suspicious on its own — the same absence-of-evidence
 * principle from §7 applies here as much as to a disabled camera."
 */
export interface DeviceBundleInput {
  readonly consentGranted: boolean;
  readonly windowMs: number;
  readonly tabFocusChangeCount: number | null;
  readonly applicationSwitchCount: number | null;
  readonly clipboardPasteCount: number | null;
  readonly keyboardRhythmAnomalyCount: number | null;
}

/**
 * The Device/OS Bundle Adapter (RFC §4-F / Bundle F; Plan M10). ADR-16:
 * "weighted near-zero for identity, kept as a separate parallel track" —
 * this adapter still emits ordinary `EvidenceEvent`s into the same
 * `device` bundle (RFC explicitly frames this as *this* codebase's scope:
 * the RFC's own "assistance-integrity" parallel-fusion-track idea is
 * "noted, not built out here" by the RFC itself, so this codebase does not
 * build it either) — but the Fusion Engine (`fusion/likelihoodRatios.ts`)
 * registers every one of these signals at a deliberately tiny magnitude,
 * so their practical effect on the identity score stays negligible no
 * matter how much device activity a session shows.
 */
export class DeviceBundleAdapter implements BundleAdapter<DeviceBundleInput> {
  readonly bundle = 'device' as const;

  buildEvidenceEvents(
    sessionId: string,
    input: DeviceBundleInput,
    occurredAt: Date = new Date(),
  ): readonly NewEvidenceEvent[] {
    if (!input.consentGranted) {
      return DEVICE_SIGNAL_NAMES.map((signalName) =>
        makeEvidenceEvent({
          sessionId,
          bundle: this.bundle,
          signalName,
          healthStatus: 'NO_SIGNAL_DETECTED',
          value: null,
          occurredAt,
        }),
      );
    }

    return [
      this.buildCountEvent(
        sessionId,
        'tab_focus_change',
        input.tabFocusChangeCount,
        input.windowMs,
        occurredAt,
      ),
      this.buildCountEvent(
        sessionId,
        'application_switch',
        input.applicationSwitchCount,
        input.windowMs,
        occurredAt,
      ),
      this.buildCountEvent(
        sessionId,
        'clipboard_paste',
        input.clipboardPasteCount,
        input.windowMs,
        occurredAt,
      ),
      this.buildCountEvent(
        sessionId,
        'keyboard_rhythm_anomaly',
        input.keyboardRhythmAnomalyCount,
        input.windowMs,
        occurredAt,
      ),
    ];
  }

  private buildCountEvent(
    sessionId: string,
    signalName: DeviceSignalName,
    count: number | null,
    windowMs: number,
    occurredAt: Date,
  ): NewEvidenceEvent {
    if (count === null) {
      return makeEvidenceEvent({
        sessionId,
        bundle: this.bundle,
        signalName,
        healthStatus: 'NO_SIGNAL_DETECTED',
        value: null,
        occurredAt,
      });
    }
    const value: DeviceEventCountValue = { count, windowMs };
    return makeEvidenceEvent({
      sessionId,
      bundle: this.bundle,
      signalName,
      healthStatus: 'OK',
      value,
      occurredAt,
    });
  }
}
