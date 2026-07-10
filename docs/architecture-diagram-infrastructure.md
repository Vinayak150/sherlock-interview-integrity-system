# Infrastructure Architecture

Deployable components and supporting infrastructure in the current
implementation.

```mermaid
flowchart TB

  subgraph DATA["Data Stores"]
    PG[("PostgreSQL")]
    RD[("Redis")]
  end

  subgraph ORCH["Orchestrator"]
    API["httpServer"]
    SOS["SessionOrchestrationService"]
    SREC["Session Recovery"]
    SR["SessionRouter"]
    CHR["ConsistentHashRing"]
    RSR["RedisSessionRegistry"]
  end

  MS["model-serving"]
  DASH["dashboard"]
  CA["client-agent"]

  RD --> RSR
  RSR --> SR
  CHR --> SR
  SR --> SREC
  SREC --> PG
  SOS --> PG
  API --> SOS
  SOS --> MS
  DASH --> API
  CA --> API
```

**Note:** Session Recovery is implemented as `SessionLifecycleStore` (snapshot
replay on replica handoff). `SessionRouter` is implemented and tested but not
wired into the single-replica `orchestrator/src/index.ts` entrypoint; ingress
routing is deferred to the load balancer per RFC §9.4.
