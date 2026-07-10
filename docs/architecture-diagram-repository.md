# Repository Structure

How the major monorepo packages relate. The orchestrator hosts all in-process
domain modules; other packages are separate deployables or clients.

```mermaid
flowchart TB

  C["contracts"]
  O["orchestrator"]
  MS["model-serving"]
  D["dashboard"]
  CA["client-agent"]

  C --> O
  C --> D
  C --> CA
  O --> MS
  D --> O
  CA --> O

  subgraph ORCH["orchestrator/src modules"]
    direction LR
    B["bundles/"]
    F["fusion/"]
    SM["statemachine/"]
    DEC["decision/"]
    EXP["explanation/"]
    PER["persistence/"]
    RT["routing/"]
    API["api/"]
    SEC["security/"]
    MSC["modelserving_client/"]
  end

  O --- ORCH
```

`eval/` lives under `orchestrator/src/eval/` as offline tooling and is not on
the live request path.
