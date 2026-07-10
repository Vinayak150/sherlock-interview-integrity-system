"""Liveness/anti-spoof detection (RFC §4-C: "liveness/anti-spoof cues";
§15's threat model: "Spoofing (photo/replay/video-loop)").
"""

from model_serving.liveness.detector import LivenessDetector, StubLivenessDetector

__all__ = ["LivenessDetector", "StubLivenessDetector"]
