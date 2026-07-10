/**
 * Public surface of the Privacy & Compliance Layer (RFC §15/Pilot-
 * readiness bar; Plan M16).
 */
export type { EncryptedField } from './fieldEncryption.js';
export { FieldDecryptionError, decryptField, encryptField } from './fieldEncryption.js';

export { EncryptingEvidenceEventRepository } from './encryptingEvidenceEventRepository.js';

export type { AuditLogEntry, AuditLogRepository, NewAuditLogEntry } from './auditLogRepository.js';
export { InMemoryAuditLogRepository } from './auditLogRepository.js';

export type { Appeal, AppealRepository, AppealStatus, NewAppeal } from './appealRepository.js';
export { AppealNotFoundError, InMemoryAppealRepository } from './appealRepository.js';
