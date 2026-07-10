import { describe, expect, it } from 'vitest';

import { MetadataBundleAdapter } from './metadataBundleAdapter.js';
import type { SessionJoinMetadata } from './metadataBundleAdapter.js';

function metadata(overrides: Partial<SessionJoinMetadata> = {}): SessionJoinMetadata {
  return {
    joinMethod: null,
    joinOrder: null,
    observedIpCountry: null,
    statedCountry: null,
    observedDeviceFingerprint: null,
    priorSessionDeviceFingerprint: null,
    virtualCaptureDeviceDetected: null,
    screenShareState: null,
    multiMonitorDetected: null,
    ...overrides,
  };
}

const OCCURRED_AT = new Date('2026-07-10T12:00:00.000Z');

describe('MetadataBundleAdapter', () => {
  const adapter = new MetadataBundleAdapter();

  it('tags every event with the metadata bundle and the requested occurredAt', () => {
    const events = adapter.buildEvidenceEvents('session-1', metadata(), OCCURRED_AT);

    expect(events).toHaveLength(6);
    for (const event of events) {
      expect(event.bundle).toBe('metadata');
      expect(event.sessionId).toBe('session-1');
      expect(event.occurredAt).toBe(OCCURRED_AT);
    }
  });

  it('reports every signal NO_SIGNAL_DETECTED when nothing was observed', () => {
    const events = adapter.buildEvidenceEvents('session-1', metadata(), OCCURRED_AT);

    for (const event of events) {
      expect(event.healthStatus).toBe('NO_SIGNAL_DETECTED');
    }
  });

  it('reports join_method OK with the observed method and join order', () => {
    const events = adapter.buildEvidenceEvents(
      'session-1',
      metadata({ joinMethod: 'direct_invite_link', joinOrder: 1 }),
      OCCURRED_AT,
    );

    const joinMethod = events.find((event) => event.signalName === 'join_method');
    expect(joinMethod).toMatchObject({
      healthStatus: 'OK',
      value: { method: 'direct_invite_link', joinOrder: 1 },
    });
  });

  it('reports join_method NO_SIGNAL_DETECTED when the method is unknown', () => {
    const events = adapter.buildEvidenceEvents(
      'session-1',
      metadata({ joinOrder: 3 }),
      OCCURRED_AT,
    );

    const joinMethod = events.find((event) => event.signalName === 'join_method');
    expect(joinMethod).toMatchObject({
      healthStatus: 'NO_SIGNAL_DETECTED',
      value: { method: 'unknown', joinOrder: 3 },
    });
  });

  it('reports ip_geolocation_consistency as consistent when observed and stated countries match', () => {
    const events = adapter.buildEvidenceEvents(
      'session-1',
      metadata({ observedIpCountry: 'US', statedCountry: 'US' }),
      OCCURRED_AT,
    );

    const geo = events.find((event) => event.signalName === 'ip_geolocation_consistency');
    expect(geo).toMatchObject({ healthStatus: 'OK', value: { consistent: true } });
  });

  it('reports ip_geolocation_consistency as inconsistent when countries differ', () => {
    const events = adapter.buildEvidenceEvents(
      'session-1',
      metadata({ observedIpCountry: 'US', statedCountry: 'IN' }),
      OCCURRED_AT,
    );

    const geo = events.find((event) => event.signalName === 'ip_geolocation_consistency');
    expect(geo).toMatchObject({ healthStatus: 'OK', value: { consistent: false } });
  });

  it('reports ip_geolocation_consistency NO_SIGNAL_DETECTED with a null consistent flag when only one side is known', () => {
    const events = adapter.buildEvidenceEvents(
      'session-1',
      metadata({ observedIpCountry: 'US', statedCountry: null }),
      OCCURRED_AT,
    );

    const geo = events.find((event) => event.signalName === 'ip_geolocation_consistency');
    expect(geo).toMatchObject({
      healthStatus: 'NO_SIGNAL_DETECTED',
      value: { consistent: null, observedValue: 'US', statedValue: null },
    });
  });

  it('reports device_fingerprint_continuity as continuous when fingerprints match', () => {
    const events = adapter.buildEvidenceEvents(
      'session-1',
      metadata({ observedDeviceFingerprint: 'fp-123', priorSessionDeviceFingerprint: 'fp-123' }),
      OCCURRED_AT,
    );

    const fingerprint = events.find(
      (event) => event.signalName === 'device_fingerprint_continuity',
    );
    expect(fingerprint).toMatchObject({ healthStatus: 'OK', value: { consistent: true } });
  });

  it('reports device_fingerprint_continuity NO_SIGNAL_DETECTED for a first-time candidate with no prior fingerprint', () => {
    const events = adapter.buildEvidenceEvents(
      'session-1',
      metadata({ observedDeviceFingerprint: 'fp-123', priorSessionDeviceFingerprint: null }),
      OCCURRED_AT,
    );

    const fingerprint = events.find(
      (event) => event.signalName === 'device_fingerprint_continuity',
    );
    expect(fingerprint?.healthStatus).toBe('NO_SIGNAL_DETECTED');
  });

  it('reports virtual_capture_device_detected OK with the observed boolean', () => {
    const events = adapter.buildEvidenceEvents(
      'session-1',
      metadata({ virtualCaptureDeviceDetected: true }),
      OCCURRED_AT,
    );

    const detection = events.find(
      (event) => event.signalName === 'virtual_capture_device_detected',
    );
    expect(detection).toMatchObject({ healthStatus: 'OK', value: { detected: true } });
  });

  it('reports multi_monitor_detected OK with the observed boolean', () => {
    const events = adapter.buildEvidenceEvents(
      'session-1',
      metadata({ multiMonitorDetected: false }),
      OCCURRED_AT,
    );

    const detection = events.find((event) => event.signalName === 'multi_monitor_detected');
    expect(detection).toMatchObject({ healthStatus: 'OK', value: { detected: false } });
  });

  it('reports screen_share_state OK with the observed state', () => {
    const events = adapter.buildEvidenceEvents(
      'session-1',
      metadata({ screenShareState: 'sharing_application' }),
      OCCURRED_AT,
    );

    const screenShare = events.find((event) => event.signalName === 'screen_share_state');
    expect(screenShare).toMatchObject({
      healthStatus: 'OK',
      value: { state: 'sharing_application' },
    });
  });

  it('defaults occurredAt to the current time when not supplied', () => {
    const before = Date.now();
    const events = adapter.buildEvidenceEvents('session-1', metadata());
    const after = Date.now();

    const occurredAtMs = events[0]?.occurredAt.getTime() ?? -1;
    expect(occurredAtMs).toBeGreaterThanOrEqual(before);
    expect(occurredAtMs).toBeLessThanOrEqual(after);
  });
});
