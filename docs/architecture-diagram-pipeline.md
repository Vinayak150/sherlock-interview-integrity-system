# Runtime Processing Pipeline

End-to-end request flow inside the orchestrator, as implemented by
`SessionOrchestrationService` and its downstream modules.

```mermaid
flowchart TB

  P["Participant Streams"]
  API["API"]
  BA["Bundle Adapters"]
  ES["Evidence Store"]
  FU["FusionEngine"]
  LSM["Lifecycle FSM"]
  DE["DecisionEngine"]
  EE["ExplanationEngine"]
  OUT["Outputs"]

  P --> API
  API --> BA
  BA --> ES
  ES --> FU
  FU --> LSM
  LSM --> DE
  DE --> EE
  EE --> OUT

  BA -.-> MS["Model Serving"]
```

`ChangePointDetector` and `LlmNarrativeAdapter` sit on the visual/audio and
explanation paths respectively; they are omitted here to keep the main pipeline
readable.
