"""Request/response contracts for the serving API. Kept in one module,
mirroring the orchestrator's `@sherlock/contracts` convention of a single,
explicit shared-shape source rather than inline dicts scattered across
route handlers.
"""

from __future__ import annotations

import base64

from pydantic import BaseModel, Field, field_validator


class InferenceRequest(BaseModel):
    session_id: str = Field(min_length=1, alias="sessionId")
    # Base64-encoded raw capture bytes (a frame, an audio chunk, ...). The
    # RFC's own scope (§9.5, §15) is explicit that only the derived signal
    # -- not raw media -- is retained beyond the momentary processing
    # window; this field is never persisted by the serving API itself.
    payload: str = Field(min_length=1)

    model_config = {"populate_by_name": True}

    @field_validator("payload")
    @classmethod
    def payload_must_be_valid_base64(cls, value: str) -> str:
        try:
            decoded = base64.b64decode(value, validate=True)
        except Exception as exc:  # noqa: BLE001 -- surfaced as a 422 by FastAPI, not swallowed.
            raise ValueError("payload must be valid base64") from exc
        if len(decoded) == 0:
            raise ValueError("decoded payload must not be empty")
        return value

    def decoded_payload(self) -> bytes:
        return base64.b64decode(self.payload)


class EmbeddingResponse(BaseModel):
    session_id: str = Field(serialization_alias="sessionId")
    embedding: list[float]
    dimension: int

    model_config = {"populate_by_name": True}


class LivenessResponse(BaseModel):
    session_id: str = Field(serialization_alias="sessionId")
    score: float
    is_live: bool = Field(serialization_alias="isLive")

    model_config = {"populate_by_name": True}


class HealthResponse(BaseModel):
    status: str
