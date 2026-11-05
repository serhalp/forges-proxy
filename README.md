# forges-proxy

A self-hostable, single-tenant HTTP proxy for [`forges`](https://forges.link): one API and one cache in front of every forge you configure. See [ARCHITECTURE.md](./ARCHITECTURE.md) for the design and [PLAN.md](./PLAN.md) for what's next.

## Use cases

- Non-JS clients reaching `forges` over HTTP, from the OpenAPI document.
- Internal tools, bots and CI across several forges, with credentials in one place and rate limits pooled behind one cache.
- Public read-only services such as [npmx](https://npmx.dev), where many readers share one cache in front of every forge.
- Browsers and sandboxes whose network access is limited to known hosts (CSP, egress allowlists) reaching forges whose hosts aren't known in advance: Tangled reads go to each author's server and per-repo knots, and self-hosted forges and Radicle nodes can be anywhere.
- AI agents, given forge access without holding tokens.

## Configure

Providers come from `FORGES_<KIND>_<FIELD>[_<SUFFIX>]` variables, as `forgesFromEnv()` reads them (e.g. `FORGES_GITHUB_TOKEN`, `FORGES_GITLAB_ENABLED=1`).

Set exactly one of:

- `FORGES_PROXY_SECRET`: private instance. Callers send `Authorization: Bearer <secret>` to everything but `/docs`, `/openapi.json` and webhooks. Every verb is routed.
- `FORGES_PROXY_PUBLIC=1`: public instance. No auth, and only verbs that need neither an account nor write access are routed. Use tokens that can only read public data.

## Use

```sh
pnpm install
pnpm dev
```

- `GET /`: configured providers, their capabilities, and the routed verbs with the position of their options.
- `GET /docs`: API reference (Scalar), from `GET /openapi.json` (OpenAPI 3.1).
- `GET /status`: each provider's rate-limit budgets, as the server instance that answers last saw them.
- `GET /:forge/:instance/:verb?args=<json array>`: a read, e.g. `repos.get`, `threads.list`.
- `POST /:forge/:instance/:verb` with `{ "args": [...] }`: a write.

Arguments are positional, as the `ForgeProvider` method takes them, and are validated against the verb's signature (see `/docs`). Pass `null` for a skipped optional argument. Bytes travel as `{ "$bytes": "<base64>" }` in both directions. A listing answers with one page; pass its `cursor` back in the options to read the next.

```sh
curl -G localhost:3000/github/github.com/repos.get \
  --data-urlencode 'args=[{"forge":"github","instance":"github.com","owner":"danielroe","name":"forges"}]'
```

## Client

`client/remote.ts` turns the proxy back into `forges` providers, so code written against `forges` works unchanged:

```ts
import { createForges } from "forges"
import { connect } from "#client/remote.ts"

const forges = createForges(await connect({ url: "https://forges.example.com", secret }))
const repo = await forges.repos.get({
  forge: "github",
  instance: "github.com",
  owner: "danielroe",
  name: "forges",
})
```

Every verb is present. Listings read a page per request, both when iterated and through `page()`, errors come back as the same classes, and verbs the proxy doesn't route reject with `UnsupportedOperationError` (and `can()` says so).

## Webhooks and purging

Point a forge's webhook at `/webhooks/:forge/:instance` and set the provider's `FORGES_<KIND>_WEBHOOK_SECRET`. Each delivery is verified, and the CDN entries of every repository it concerns are purged by cache tag. On Netlify this is automatic, with the `NETLIFY_PURGE_API_TOKEN` Netlify gives functions. Elsewhere, entries expire by age (60 seconds, then served stale for up to 10 minutes while they refresh).

## Upstream cache

The proxy keeps upstream JSON responses and revalidates them with their `etag`, so a CDN miss usually costs a `304` (free on GitHub's rate limit for authenticated requests) or nothing. Where the platform has the Cache API (Netlify), the entries are shared by every instance in a region and purged by the same webhooks; elsewhere they're in memory. While upstream is rate-limited or failing, a stored response stands in for up to a day past its freshness. Each response's `x-upstream-cache` header lists what happened to its upstream requests: `fresh`, `revalidated`, `fetched` or `stale`.

## Operations manifest

`server/manifest.json` describes every routed verb: its parameters, result and docs, with JSON Schemas read from the `forges` types. The OpenAPI document is built from it, and the proxy uses it to pass each request's abort signal into the verb's options. Regenerate it after changing `forges`:

```sh
pnpm manifest
```

A test fails while it's stale.
