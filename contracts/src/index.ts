/**
 * @sherlock/contracts
 *
 * Repository-structure placeholder (RFC §5): this package is where the
 * cross-component schemas (EvidenceEvent, the OK / NO_SIGNAL_DETECTED /
 * SERVICE_UNAVAILABLE signal-health status, LifecycleState, EvidenceReport,
 * ...) will live so orchestrator, model-serving, client-agent, and dashboard
 * cannot drift on shape between each other.
 *
 * M0 scope is repository/tooling scaffolding only — no domain or evidence
 * types are defined here yet. This module intentionally exports nothing but
 * a package identity marker so the workspace builds, is testable, and is
 * importable by other workspaces ahead of the milestone that defines the
 * real contracts.
 */

export const CONTRACTS_PACKAGE_NAME = '@sherlock/contracts' as const;
