# Sherlock — Architecture Diagrams

Implementation architecture for the current repository (M0–M16). These
diagrams reflect **what is built**, not the original implementation plan.

| Diagram | Description |
|---------|-------------|
| [Overall System Architecture](architecture-diagram-overall.md) | High-level deployables and data flow (10–15 boxes) |
| [Runtime Processing Pipeline](architecture-diagram-pipeline.md) | In-process evidence-to-output pipeline |
| [Infrastructure Architecture](architecture-diagram-infrastructure.md) | PostgreSQL, Redis, routing, recovery, and clients |
| [Repository Structure](architecture-diagram-repository.md) | Monorepo packages and orchestrator modules |
| [Deployment Architecture](architecture-diagram-deployment.md) | Railway topology and service data flow |

## Pilot notes

- **Model Serving** uses stub extractors (`StubEmbeddingExtractor`,
  `StubLivenessDetector`) — no real GPU models are loaded.
- **SessionRouter** is built and tested but not enforced at the orchestrator
  ingress in the single-replica entrypoint.
- **Security** audit log and appeals use in-memory repositories in the Pilot
  deployment.
