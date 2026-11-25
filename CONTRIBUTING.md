# Contributing

## Setup

```sh
pnpm install                              # also downloads the Node.js and pnpm versions in `devEngines`
FORGES_PROXY_PUBLIC=1 FORGES_GITHUB_ENABLED=1 pnpm --filter @forges-proxy/server dev   # http://localhost:3000
```

## Layout

This repo is a pnpm workspace. The server uses [h3](https://h3.dev/) v2 and builds with
[tsdown](https://tsdown.dev/).

- `packages/server`: `@forges-proxy/server`. `src/index.ts` (`createServer()`) wires the middleware
  and routes (`src/routes/`). `src/manifest.ts` re-exports verb and model schemas from
  `forges/schema`.
- `packages/client`: `@forges-proxy/client` (`discoverProviders()`, `proxyProvider()`,
  `fetchProxyMeta()`).
- `packages/docs`: placeholder for the documentation site.
- `demos/*`: example deployments for each platform and framework. Keep platform-specific code in the
  demos and pass it to `createServer()` via options.

During tests, typechecking, and scripts, workspace packages resolve each other's TypeScript source
directly via the `@forges-proxy/source` export condition. Demos consume the built `dist/` output, so
run `pnpm build` after modifying a package.

## Conventions

- Use relative imports with explicit `.ts` extensions (e.g. `./verbs.ts`).
- Place unit tests next to the module they test (`src/verbs.test.ts`). Put multi-module integration
  tests (like full HTTP route tests) in `test/`.

## Checks

Run before opening a PR:

- `pnpm typecheck`
- `pnpm lint`
- `pnpm knip`
- `pnpm test`
- `pnpm format`
- `pnpm zizmor` (after modifying `.github/`)

Use `pnpm smoke <url> [secret]` to test a running deployment end-to-end through the client.

`pnpm test` runs on the Node.js version specified in `devEngines`. CI also runs the test suite on
the minimum supported Node.js version in `engines`.

## Demos

The Netlify and Vercel demos include "Deploy" buttons that clone only the demo subdirectory into a
new user repository. Because of that, files inside those demo directories cannot reference monorepo
paths or workspace commands. Instead, our live demo sites configure the monorepo build settings in
the platform dashboard:

- **Base directory** (Netlify) / **Root directory** (Vercel): set to the demo's directory (e.g.
  `demos/netlify-serverless`). Exception: for `demos/netlify-server`, leave Base directory empty and
  set **Package directory** to `demos/netlify-server` instead (setting Base directory triggers a
  path-doubling bug in `@netlify/build` that skips bundling `netlify/server`).
- **Build command**: `pnpm --filter <demo package>... build`, which builds workspace dependencies
  before building the demo.

When deploying a demo manually via CLI, run the command from the demo's own directory (e.g.
`cd demos/netlify-edge && netlify deploy`) rather than using `pnpm --filter` from the repo root.
