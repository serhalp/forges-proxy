# forges-proxy

A self-hostable, single-tenant HTTP proxy for [`forges`](https://forges.link): one API and one cache in front of every forge you configure. See [PLAN.md](./PLAN.md) for the design.

## Configure

Providers come from `FORGES_<KIND>_<FIELD>[_<SUFFIX>]` variables, as `forgesFromEnv()` reads them (e.g. `FORGES_GITHUB_TOKEN`, `FORGES_GITLAB_ENABLED=1`).

Set exactly one of:

- `FORGES_PROXY_SECRET`: private instance. Callers send `Authorization: Bearer <secret>`. Every verb is routed.
- `FORGES_PROXY_PUBLIC=1`: public instance. No auth, and only verbs that need neither an account nor write access are routed. Use tokens that can only read public data.

## Use

```sh
pnpm install
pnpm dev
```

- `GET /v1`: configured providers, their capabilities, and the routed verbs.
- `GET /v1/:forge/:instance/:verb?args=<json array>`: a read, e.g. `repos.get`, `threads.listPage`.
- `POST /v1/:forge/:instance/:verb` with `{ "args": [...] }`: a write.

Arguments are positional, as the `ForgeProvider` method takes them. Listings are exposed as their `*Page` verb; pass `cursor` back to read the next page.

```sh
curl -G localhost:3000/v1/github/github.com/repos.get \
  --data-urlencode 'args=[{"forge":"github","instance":"github.com","owner":"danielroe","name":"forges"}]'
```
