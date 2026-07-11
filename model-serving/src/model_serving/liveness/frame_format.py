"""Frame decoding and validation for the liveness pipeline."""

from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np

from model_serving.liveness.liveness_errors import LivenessDetectionError, LivenessDetectionErrorCode

MIN_FRAME_EDGE_PX = 80


@dataclass(frozen=True)
class DecodedFrame:
    image_bgr: np.ndarray
    width: int
    height: int


def decode_frame(payload: bytes) -> DecodedFrame:
    if len(payload) == 0:
        raise LivenessDetectionError(
            LivenessDetectionErrorCode.CORRUPTED_FRAME,
            "frame payload must not be empty",
        )

    image_array = np.frombuffer(payload, dtype=np.uint8)
    if image_array.size == 0:
        raise LivenessDetectionError(
            LivenessDetectionErrorCode.CORRUPTED_FRAME,
            "frame payload contains no bytes",
        )

    image = cv2.imdecode(image_array, cv2.IMREAD_COLOR)
    if image is None:
        raise LivenessDetectionError(
            LivenessDetectionErrorCode.UNSUPPORTED_IMAGE_FORMAT,
            "payload must be a valid encoded image (JPEG or PNG)",
        )

    height, width = image.shape[:2]
    if width < MIN_FRAME_EDGE_PX or height < MIN_FRAME_EDGE_PX:
        raise LivenessDetectionError(
            LivenessDetectionErrorCode.LOW_RESOLUTION,
            f"frame resolution {width}x{height} is below minimum {MIN_FRAME_EDGE_PX}px",
        )

    return DecodedFrame(image_bgr=image, width=width, height=height)
