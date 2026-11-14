# Contributing

## Setup

```sh
pnpm install                              # also fetches the Node.js and pnpm in `devEngines`
pnpm --filter @forges-proxy/server dev    # the proxy from `process.env`, on http://localhost:3000
```

## Layout

A pnpm workspace. The server is [h3](https://h3.dev/) v2, built with [tsdown](https://tsdown.dev/).

- `packages/server`: the proxy. `src/index.ts` (`createServer()`) wires the routes (`src/routes/`) and middleware. `scripts/generate-manifest.ts` writes `src/manifest.json` (`pnpm --filter @forges-proxy/server manifest`); a test fails when it's stale.
- `packages/client`: `connect()`.
- `packages/docs`: placeholder.
- `demos/*`: one deployment per platform or framework. Nothing platform-specific goes in the packages; it's an option a demo passes.

Packages resolve each other's source through the `@forges-proxy/source` export condition (tests, typecheck, scripts). Demos use the packages' builds, so run `pnpm build` after changing a package.

## Conventions

- Relative imports with explicit `.ts` extensions (e.g. `./verbs.ts`).
- Unit tests sit next to the module they test (`src/verbs.test.ts`). `test/` is for suites that span modules, such as requests through the whole server.

## Checks

Before a PR: `pnpm typecheck`, `pnpm lint`, `pnpm knip`, `pnpm test`, `pnpm format`. After touching `.github/`: `pnpm zizmor`. `pnpm smoke <url> [secret]` checks a running deployment through the client.

`pnpm test` runs on the Node.js in `devEngines`; CI also runs the tests on the oldest supported Node.js (`engines`).

## Demos

The Netlify and Vercel demos have deploy buttons, which copy the demo's directory alone into a new repository. So their files hold no monorepo paths or commands, and their live sites set these in the platform's settings instead:

- Base (Netlify) or root (Vercel) directory: the demo's directory. Netlify Server sets the package directory instead (no base): with a base directory, `@netlify/build` looks for `netlify/server` at a doubled path and silently skips it.
- Build command: `pnpm --filter <demo package>... build`, which first builds the workspace packages the demo uses.

Deploy them by hand from the demo's directory (e.g. `cd demos/netlify-edge && netlify deploy`), not with `--filter` from the root.
