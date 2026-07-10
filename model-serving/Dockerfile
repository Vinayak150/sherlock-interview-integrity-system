# syntax=docker/dockerfile:1
#
# Model-serving deployable (RFC §9.2/§9.6). Self-contained build context:
#   docker build -f model-serving/Dockerfile -t sherlock-model-serving model-serving
# (docker-compose.yml at the repo root is already wired this way.)

FROM python:3.11-slim AS base
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

FROM base AS build
COPY pyproject.toml ./
COPY src ./src
RUN pip install --no-cache-dir .

FROM base AS runtime
RUN useradd --system --create-home sherlock
COPY --from=build /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY --from=build /usr/local/bin /usr/local/bin
COPY src ./src
USER sherlock
ENV PYTHONPATH=/app/src
EXPOSE 8081
CMD ["python", "-m", "model_serving.main"]
