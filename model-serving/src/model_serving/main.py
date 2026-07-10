"""Model-serving entrypoint.

M0 proved the process starts, reads its environment, and logs correctly,
with no inference modules loaded. M8 ("bring up the second deployable ...
behind the RPC contract") is the first milestone that stands up the real
serving API, behind stub extractors/detectors (see `embeddings/`,
`liveness/`) -- no GPU pool or real model is loaded here; that is
explicitly out of scope for this codebase (no models are trained/licensed
as part of this exercise).
"""

from __future__ import annotations

import uvicorn

from model_serving.config import load_config
from model_serving.logger import create_logger
from model_serving.serving_api.app import create_app


def main() -> None:
    config = load_config()
    logger = create_logger(config)

    logger.info(
        f"model-serving starting, service_name={config.service_name}, "
        f"http={config.http_host}:{config.http_port}"
    )
    logger.warning(
        "serving stub embedding/liveness implementations only -- no real biometric model is "
        "loaded (see embeddings/extractor.py, liveness/detector.py)"
    )

    app = create_app()
    uvicorn.run(
        app, host=config.http_host, port=config.http_port, log_level=config.log_level.lower()
    )


if __name__ == "__main__":
    main()
