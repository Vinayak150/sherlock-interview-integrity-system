# syntax=docker/dockerfile:1
#
# Orchestrator deployable (RFC §9.2/§9.6). Built from the *repository root*
# as the Docker build context, since it depends on the @sherlock/contracts
# workspace package — build with:
#   docker build -f orchestrator/Dockerfile -t sherlock-orchestrator .
# (docker-compose.yml at the repo root is already wired this way.)

FROM node:20-alpine AS base
WORKDIR /app

# --- deps: install full (dev+prod) workspace dependencies once ---
FROM base AS deps
COPY package.json package-lock.json* ./
COPY contracts/package.json contracts/package.json
COPY orchestrator/package.json orchestrator/package.json
RUN npm ci --workspaces --include-workspace-root

# --- build: compile contracts then orchestrator ---
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/package.json ./package.json
COPY tsconfig.base.json ./tsconfig.base.json
COPY contracts ./contracts
COPY orchestrator ./orchestrator
RUN npm run build --workspace=@sherlock/contracts
RUN npm run build --workspace=@sherlock/orchestrator

# --- prune: install production-only dependencies for the runtime image ---
FROM base AS prod-deps
COPY package.json package-lock.json* ./
COPY contracts/package.json contracts/package.json
COPY orchestrator/package.json orchestrator/package.json
RUN npm ci --workspaces --include-workspace-root --omit=dev

# --- runtime ---
FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S sherlock && adduser -S sherlock -G sherlock
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/contracts/dist ./contracts/dist
COPY --from=build /app/contracts/package.json ./contracts/package.json
COPY --from=build /app/orchestrator/dist ./orchestrator/dist
COPY --from=build /app/orchestrator/package.json ./orchestrator/package.json
USER sherlock
WORKDIR /app/orchestrator
CMD ["node", "dist/index.js"]
