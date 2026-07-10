import { describe, expect, it } from 'vitest';

import { IngestEvidenceRequestSchema } from './schemas.js';

function validRequest(): unknown {
  return {
    candidate: {
      candidateId: 'candidate-1',
      displayName: 'Jane Doe',
      joinEmail: 'jane.doe@example.com',
      calendarAttendeeEmail: 'jane.doe@example.com',
    },
    metadata: {
      joinMethod: 'direct_invite_link',
      joinOrder: 1,
      observedIpCountry: 'US',
      statedCountry: 'US',
      observedDeviceFingerprint: null,
      priorSessionDeviceFingerprint: null,
      virtualCaptureDeviceDetected: false,
      screenShareState: 'not_sharing',
      multiMonitorDetected: false,
    },
  };
}

describe('IngestEvidenceRequestSchema', () => {
  it('accepts a well-formed request', () => {
    expect(() => IngestEvidenceRequestSchema.parse(validRequest())).not.toThrow();
  });

  it('accepts null for every nullable candidate/metadata field', () => {
    const request = validRequest() as ReturnType<typeof validRequest> & {
      candidate: Record<string, unknown>;
      metadata: Record<string, unknown>;
    };
    request.candidate.displayName = null;
    request.candidate.joinEmail = null;
    request.candidate.calendarAttendeeEmail = null;
    request.metadata.joinMethod = null;
    request.metadata.joinOrder = null;
    request.metadata.screenShareState = null;
    request.metadata.virtualCaptureDeviceDetected = null;
    request.metadata.multiMonitorDetected = null;

    expect(() => IngestEvidenceRequestSchema.parse(request)).not.toThrow();
  });

  it('rejects a missing candidateId', () => {
    const request = validRequest() as { candidate: Record<string, unknown> };
    delete request.candidate.candidateId;

    expect(() => IngestEvidenceRequestSchema.parse(request)).toThrow();
  });

  it('rejects an empty candidateId', () => {
    const request = validRequest() as { candidate: Record<string, unknown> };
    request.candidate.candidateId = '  ';

    expect(() => IngestEvidenceRequestSchema.parse(request)).toThrow();
  });

  it('rejects an unrecognized joinMethod', () => {
    const request = validRequest() as { metadata: Record<string, unknown> };
    request.metadata.joinMethod = 'sneaked_in_the_back';

    expect(() => IngestEvidenceRequestSchema.parse(request)).toThrow();
  });

  it('rejects an unrecognized screenShareState', () => {
    const request = validRequest() as { metadata: Record<string, unknown> };
    request.metadata.screenShareState = 'presenting';

    expect(() => IngestEvidenceRequestSchema.parse(request)).toThrow();
  });

  it('rejects a negative joinOrder', () => {
    const request = validRequest() as { metadata: Record<string, unknown> };
    request.metadata.joinOrder = -1;

    expect(() => IngestEvidenceRequestSchema.parse(request)).toThrow();
  });

  it('rejects a missing metadata object entirely', () => {
    const request = validRequest() as Record<string, unknown>;
    delete request.metadata;

    expect(() => IngestEvidenceRequestSchema.parse(request)).toThrow();
  });

  it('rejects a completely malformed payload', () => {
    expect(() => IngestEvidenceRequestSchema.parse('not an object')).toThrow();
    expect(() => IngestEvidenceRequestSchema.parse(null)).toThrow();
    expect(() => IngestEvidenceRequestSchema.parse(undefined)).toThrow();
  });
});
