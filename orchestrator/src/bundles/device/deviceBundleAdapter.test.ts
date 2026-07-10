import { describe, expect, it } from 'vitest';

import { DeviceBundleAdapter } from './deviceBundleAdapter.js';
import type { DeviceBundleInput } from './deviceBundleAdapter.js';

const OCCURRED_AT = new Date('2026-07-10T12:00:00.000Z');

function input(overrides: Partial<DeviceBundleInput> = {}): DeviceBundleInput {
  return {
    consentGranted: true,
    windowMs: 60_000,
    tabFocusChangeCount: 0,
    applicationSwitchCount: 0,
    clipboardPasteCount: 0,
    keyboardRhythmAnomalyCount: 0,
    ...overrides,
  };
}

describe('DeviceBundleAdapter', () => {
  const adapter = new DeviceBundleAdapter();

  it('reports every signal NO_SIGNAL_DETECTED when consent was declined (RFC §9.5: never treated as suspicious)', () => {
    const events = adapter.buildEvidenceEvents(
      'session-1',
      input({ consentGranted: false }),
      OCCURRED_AT,
    );

    expect(events).toHaveLength(4);
    for (const event of events) {
      expect(event.healthStatus).toBe('NO_SIGNAL_DETECTED');
      expect(event.value).toBeNull();
    }
  });

  it('reports OK with the observed counts when consent was granted', () => {
    const events = adapter.buildEvidenceEvents(
      'session-1',
      input({
        tabFocusChangeCount: 2,
        applicationSwitchCount: 1,
        clipboardPasteCount: 0,
        keyboardRhythmAnomalyCount: 0,
      }),
      OCCURRED_AT,
    );

    const tabFocus = events.find((e) => e.signalName === 'tab_focus_change');
    expect(tabFocus).toMatchObject({ healthStatus: 'OK', value: { count: 2, windowMs: 60_000 } });
  });

  it('reports NO_SIGNAL_DETECTED for an individual signal whose count is null, even with consent granted', () => {
    const events = adapter.buildEvidenceEvents(
      'session-1',
      input({ clipboardPasteCount: null }),
      OCCURRED_AT,
    );
    const clipboard = events.find((e) => e.signalName === 'clipboard_paste');
    expect(clipboard).toMatchObject({ healthStatus: 'NO_SIGNAL_DETECTED', value: null });
  });

  it('tags every event with the device bundle', () => {
    const events = adapter.buildEvidenceEvents('session-1', input(), OCCURRED_AT);
    for (const event of events) {
      expect(event.bundle).toBe('device');
      expect(event.sessionId).toBe('session-1');
    }
  });

  it('reports all four device signal names', () => {
    const events = adapter.buildEvidenceEvents('session-1', input(), OCCURRED_AT);
    const names = events.map((e) => e.signalName);
    expect(names).toEqual([
      'tab_focus_change',
      'application_switch',
      'clipboard_paste',
      'keyboard_rhythm_anomaly',
    ]);
  });
});
