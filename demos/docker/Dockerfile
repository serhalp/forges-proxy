# Build from the repository root: docker build -f demos/docker/Dockerfile -t forges-proxy .
# Uses Dockerfile.dockerignore from this directory.
# Outside this monorepo, install `@forges-proxy/server` and `srvx` directly and run `node server.ts`.
FROM node:26.11.1-alpine AS build
RUN npm install -g pnpm@12.14.0
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile \
  && pnpm --filter @forges-proxy/demo-docker... build \
  && pnpm --filter @forges-proxy/demo-docker deploy --prod /app

FROM node:26.11.1-alpine
WORKDIR /app
COPY --from=build /app .
ENV PORT=3000
EXPOSE 3000
USER node
CMD ["node", "server.ts"]
