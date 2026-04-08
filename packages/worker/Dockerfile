FROM node:20-alpine AS base
RUN corepack enable

FROM base AS build
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/
COPY packages/api/package.json packages/api/
COPY packages/worker/package.json packages/worker/
RUN pnpm install --frozen-lockfile

COPY tsconfig.base.json ./
COPY packages/shared/ packages/shared/
COPY packages/api/ packages/api/
COPY packages/worker/ packages/worker/
RUN pnpm --filter @praxis2/shared build
RUN pnpm --filter @praxis2/api build
RUN pnpm --filter @praxis2/worker build

FROM base AS production
WORKDIR /app

# Install git (needed for workspace clones and worktrees)
RUN apk add --no-cache git

# Install Claude Code CLI globally
RUN npm install -g @anthropic-ai/claude-code

# Copy built packages
COPY --from=build /app/pnpm-workspace.yaml /app/package.json /app/pnpm-lock.yaml ./
COPY --from=build /app/packages/shared/package.json packages/shared/
COPY --from=build /app/packages/shared/dist packages/shared/dist/
COPY --from=build /app/packages/shared/skills packages/shared/skills/
COPY --from=build /app/packages/api/package.json packages/api/
COPY --from=build /app/packages/api/dist packages/api/dist/
COPY --from=build /app/packages/worker/package.json packages/worker/
COPY --from=build /app/packages/worker/dist packages/worker/dist/
RUN pnpm install --frozen-lockfile --prod

# Create workspace mount point
RUN mkdir -p /workspaces

WORKDIR /app/packages/worker
CMD ["node", "dist/index.js"]
