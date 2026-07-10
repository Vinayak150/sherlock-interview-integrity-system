"""Model-serving entrypoint -- M0 scaffold.

This deliberately does not stand up a serving API, load any embedding or
classifier model, or expose an RPC endpoint: those are explicit non-goals
for M0. Its only job is to prove the deployable starts, reads its
environment, and logs correctly -- the foundation the M8 milestone builds
real inference on top of.
"""

from __future__ import annotations

import signal
import threading
from types import FrameType

from model_serving.config import load_config
from model_serving.logger import create_logger


def main() -> None:
    config = load_config()
    logger = create_logger(config)

    logger.info(
        "model-serving scaffold starting (M0 -- no inference modules loaded), "
        f"service_name={config.service_name}"
    )

    shutdown_event = threading.Event()

    def handle_signal(signum: int, _frame: FrameType | None) -> None:
        logger.info(f"model-serving scaffold shutting down, signal={signal.Signals(signum).name}")
        shutdown_event.set()

    signal.signal(signal.SIGINT, handle_signal)
    signal.signal(signal.SIGTERM, handle_signal)

    # No serving API is stood up in M0 (that arrives at M8), so the process
    # simply stays alive as a well-behaved container/service until asked to
    # stop, rather than exiting immediately after its one startup log line.
    while not shutdown_event.wait(timeout=30):
        logger.debug("model-serving scaffold heartbeat")


if __name__ == "__main__":
    main()
