/**
 * Error types for the routing module (RFC §9.4). Mirrors
 * `persistence/errors.ts`'s split between a caller-input problem and an
 * infrastructure failure, for the same reason: conflating "the registry
 * rejected malformed input" with "the registry itself is unreachable"
 * would repeat, one layer up, the same "detector said no vs. detector
 * didn't answer" mistake class ADR-11 exists to prevent.
 */

export class SessionRegistryError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'SessionRegistryError';
  }
}
