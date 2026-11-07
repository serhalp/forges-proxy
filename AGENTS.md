This project is based on [h3](https://h3.dev/) v2, built with [tsdown](https://tsdown.dev/).

## Project Structure

A pnpm workspace:

- `packages/server`: the proxy. `src/index.ts` (`createServer()`) wires h3 routes (`src/routes/`) and middleware; `scripts/generate-manifest.ts` writes `src/manifest.json`.
- `packages/client`: `connect()` and the wire protocol the server shares.
- `packages/docs`: placeholder.
- `demos/*`: one deployment per platform or framework. Nothing platform-specific goes in the packages; it's an option a demo passes.

Workspace packages resolve to each other's source through the `@forges-proxy/source` export condition (tests, typecheck, scripts); demos consume the built `dist/`, so run `pnpm build` before running them. `pnpm smoke <url> [secret]` checks a running deployment.

## Conventions

- Import local modules with the `#*` alias from `package.json` `imports` (e.g. `#src/verbs.ts` in `packages/server`), which Node, TypeScript and the bundlers all resolve natively; use explicit `.ts` extensions
