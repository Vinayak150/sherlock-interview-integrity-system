"""Model-serving entrypoint."""

from __future__ import annotations

import uvicorn

from model_serving.config import load_config
from model_serving.embeddings.insightface_extractor import InsightFaceEmbeddingExtractor
from model_serving.embeddings.speaker_extractor import SpeakerEmbeddingExtractor
from model_serving.liveness.anti_spoof_detector import ProductionLivenessDetector
from model_serving.logger import create_logger
from model_serving.observability.model_registry import ModelVersionRegistry
from model_serving.serving_api.app import create_app


def main() -> None:
    config = load_config()
    logger = create_logger(config)

    face_extractor = InsightFaceEmbeddingExtractor(
        model_name=config.insightface_model_name,
        det_size=(config.insightface_det_size, config.insightface_det_size),
    )
    face_extractor.load()

    voice_extractor = SpeakerEmbeddingExtractor()
    voice_extractor.load()

    liveness_detector = ProductionLivenessDetector(
        model_name=config.insightface_model_name,
        det_size=(config.insightface_det_size, config.insightface_det_size),
        minifasnet_model_path=config.minifasnet_model_path,
        silentface_model_path=config.silentface_model_path,
    )
    liveness_detector.load()

    logger.info(
        "model-serving starting, service_name=%s, http=%s:%s, face_backend=insightface, voice_backend=%s, liveness_backend=%s",
        config.service_name,
        config.http_host,
        config.http_port,
        voice_extractor.backend_name,
        liveness_detector.backend_name,
    )

    app = create_app(
        face_extractor=face_extractor,
        voice_extractor=voice_extractor,
        liveness_detector=liveness_detector,
        observability_logger=logger,
        model_versions=ModelVersionRegistry(
            face_model=config.insightface_model_name,
            voice_backend=voice_extractor.backend_name or "unknown",
            liveness_backend=liveness_detector.backend_name or "unknown",
        ),
    )
    uvicorn.run(
        app, host=config.http_host, port=config.http_port, log_level=config.log_level.lower()
    )


if __name__ == "__main__":
    main()
