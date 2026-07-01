# GEO API + worker image. Build from the REPO ROOT as context:
#   docker build -f apps/api/Dockerfile -t geo-api .
# Run the web service (default) or the worker: `command: ["pnpm","--filter","@geo/api","worker"]`
FROM node:22-slim AS base
ENV PNPM_HOME="/pnpm" PATH="/pnpm:$PATH"
RUN corepack enable
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# Install workspace deps (only the manifests needed for the API + its packages).
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/db/package.json packages/db/
COPY packages/core/package.json packages/core/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @geo/api...

# Copy sources.
COPY tsconfig.base.json ./
COPY packages/db packages/db
COPY packages/core packages/core
COPY apps/api apps/api

# Generate the Prisma client into packages/db/generated.
RUN pnpm --filter @geo/db generate

ENV NODE_ENV=production
EXPOSE 3000
CMD ["pnpm", "--filter", "@geo/api", "start"]
