import {
  ElicitationChallengeTypeSchema,
  JoinMethodSchema,
  ScreenShareStateSchema,
} from '@sherlock/contracts';
import { z } from 'zod';

import { LIFECYCLE_STATES } from '../statemachine/index.js';

/** Not part of `@sherlock/contracts` -- the eight-state enum is deliberately orchestrator-internal (see that package's own doc comment on why it was never added there). Built from the same `LIFECYCLE_STATES` constant `statemachine/lifecycle.ts` (M4) exports, so this schema cannot drift from it. */
const LifecycleStateSchema = z.enum(LIFECYCLE_STATES);

/**
 * HTTP request-body validation for the ingress API (Plan §5 repository
 * structure `orchestrator/api/`; this batch's "M8 — External
 * Interfaces/API Layer"). This is boundary translation -- turning
 * untyped JSON into the typed inputs the Claim/Metadata Bundle Adapters
 * (M2) already expect -- not new business logic. The enums reuse
 * `@sherlock/contracts` directly so the API layer cannot silently drift
 * from the wire contract the rest of the system already agreed on.
 */

export const ObservedIdentityClaimRequestSchema = z.object({
  candidateId: z.string().trim().min(1),
  displayName: z.string().trim().min(1).nullable(),
  joinEmail: z.string().trim().min(1).nullable(),
  calendarAttendeeEmail: z.string().trim().min(1).nullable(),
});

export type ObservedIdentityClaimRequest = z.infer<typeof ObservedIdentityClaimRequestSchema>;

export const SessionJoinMetadataRequestSchema = z.object({
  joinMethod: JoinMethodSchema.nullable(),
  joinOrder: z.number().int().nonnegative().nullable(),
  observedIpCountry: z.string().trim().min(1).nullable(),
  statedCountry: z.string().trim().min(1).nullable(),
  observedDeviceFingerprint: z.string().trim().min(1).nullable(),
  priorSessionDeviceFingerprint: z.string().trim().min(1).nullable(),
  virtualCaptureDeviceDetected: z.boolean().nullable(),
  screenShareState: ScreenShareStateSchema.nullable(),
  multiMonitorDetected: z.boolean().nullable(),
});

export type SessionJoinMetadataRequest = z.infer<typeof SessionJoinMetadataRequestSchema>;

export const IngestEvidenceRequestSchema = z.object({
  candidate: ObservedIdentityClaimRequestSchema,
  metadata: SessionJoinMetadataRequestSchema,
});

export type IngestEvidenceRequest = z.infer<typeof IngestEvidenceRequestSchema>;

/** Base64-encoded raw capture bytes -- never persisted (RFC §12/§15's "raw media not retained"), only the derived signal is. Mirrors the Model-Serving Layer's own request schema (Plan M9). */
const Base64PayloadSchema = z
  .string()
  .min(1)
  .refine(
    (value) => {
      try {
        return Buffer.from(value, 'base64').length > 0;
      } catch {
        return false;
      }
    },
    { message: 'must be valid, non-empty base64' },
  );

export const IngestVisualAudioEvidenceRequestSchema = z
  .object({
    framePayload: Base64PayloadSchema.nullable(),
    audioPayload: Base64PayloadSchema.nullable(),
  })
  .refine((value) => value.framePayload !== null || value.audioPayload !== null, {
    message: 'at least one of framePayload or audioPayload must be provided',
  });

export type IngestVisualAudioEvidenceRequest = z.infer<
  typeof IngestVisualAudioEvidenceRequestSchema
>;

/** RFC §9.5/ADR-9; Plan M10. Mirrors `@sherlock/client-agent`'s `DeviceEvidencePayload` exactly -- the client-agent package and this schema are the two ends of one wire contract. */
export const IngestDeviceEvidenceRequestSchema = z.object({
  consentGranted: z.boolean(),
  windowMs: z.number().int().positive(),
  tabFocusChangeCount: z.number().int().nonnegative().nullable(),
  applicationSwitchCount: z.number().int().nonnegative().nullable(),
  clipboardPasteCount: z.number().int().nonnegative().nullable(),
  keyboardRhythmAnomalyCount: z.number().int().nonnegative().nullable(),
});

export type IngestDeviceEvidenceRequest = z.infer<typeof IngestDeviceEvidenceRequestSchema>;

/** RFC §4-E; Plan M11. */
export const IngestLinguisticEvidenceRequestSchema = z.object({
  claims: z.array(
    z.object({
      claimTopic: z.string().trim().min(1),
      observedValue: z.string().trim().min(1).nullable(),
      claimedValue: z.string().trim().min(1).nullable(),
    }),
  ),
});

export type IngestLinguisticEvidenceRequest = z.infer<typeof IngestLinguisticEvidenceRequestSchema>;

/** RFC §4-G; Plan M11. */
export const IngestElicitationEvidenceRequestSchema = z.object({
  challengeType: ElicitationChallengeTypeSchema,
  satisfied: z.boolean().nullable(),
});

export type IngestElicitationEvidenceRequest = z.infer<
  typeof IngestElicitationEvidenceRequestSchema
>;

/** RFC §6/ADR-3; Plan M13's `HumanOverrideAction` round-trip. */
export const ApplyHumanOverrideRequestSchema = z.object({
  nextState: LifecycleStateSchema,
  reason: z.string().trim().min(1).optional(),
});

export type ApplyHumanOverrideRequest = z.infer<typeof ApplyHumanOverrideRequestSchema>;

/** RFC §11/ADR-13; Plan M13's accommodation-disclosure flow. */
export const RecordAccommodationDisclosureRequestSchema = z.object({
  reason: z.string().trim().min(1),
});

export type RecordAccommodationDisclosureRequest = z.infer<
  typeof RecordAccommodationDisclosureRequestSchema
>;

/** RFC §15/Pilot-readiness bar; Plan M16's appeal flow. */
export const FileAppealRequestSchema = z.object({
  candidateStatement: z.string().trim().min(1),
});

export type FileAppealRequest = z.infer<typeof FileAppealRequestSchema>;
