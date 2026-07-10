"""The Model-Serving Layer's HTTP surface (RFC §9.2/§9.6, Plan M8: "bring
up the second deployable with real GPU-bound inference for embeddings +
liveness, behind the RPC contract"). See `app.py`.
"""

from model_serving.serving_api.app import create_app

__all__ = ["create_app"]
