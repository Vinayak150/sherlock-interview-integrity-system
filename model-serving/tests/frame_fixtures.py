from __future__ import annotations

import cv2
import numpy as np


def encode_png(image_bgr: np.ndarray) -> bytes:
    encoded_ok, encoded = cv2.imencode(".png", image_bgr)
    if not encoded_ok:
        raise ValueError("failed to encode PNG frame")
    return encoded.tobytes()


def make_live_frame(width: int = 160, height: int = 160) -> bytes:
    image = np.zeros((height, width, 3), dtype=np.uint8)
    rng = np.random.default_rng(7)
    noise = rng.integers(30, 220, size=(height, width, 3), dtype=np.uint8)
    image = noise.copy()

    center = (width // 2, height // 2)
    axes = (width // 5, height // 4)
    cv2.ellipse(image, center, axes, 0, 0, 360, (210, 175, 155), thickness=-1)
    texture = rng.integers(0, 255, size=(height, width, 3), dtype=np.uint8)
    mask = np.zeros((height, width), dtype=np.uint8)
    cv2.ellipse(mask, center, axes, 0, 0, 360, 255, thickness=-1)
    image = np.where(mask[..., None] > 0, cv2.addWeighted(image, 0.65, texture, 0.35, 0), image)
    return encode_png(image)


def make_printed_spoof_frame(width: int = 160, height: int = 160) -> bytes:
    image = np.full((height, width, 3), (188, 156, 136), dtype=np.uint8)
    return encode_png(image)


def make_replay_frame(width: int = 160, height: int = 160) -> bytes:
    image = np.zeros((height, width, 3), dtype=np.uint8)
    for row in range(height):
        stripe = 180 if (row // 4) % 2 == 0 else 40
        image[row, :, :] = (stripe, stripe, stripe)

    center = (width // 2, height // 2)
    axes = (width // 5, height // 4)
    cv2.ellipse(image, center, axes, 0, 0, 360, (170, 140, 120), thickness=-1)
    return encode_png(image)


def make_no_face_frame(width: int = 160, height: int = 160) -> bytes:
    image = np.zeros((height, width, 3), dtype=np.uint8)
    image[:, :] = (20, 80, 160)
    return encode_png(image)
