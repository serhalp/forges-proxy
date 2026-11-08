# forges-proxy

A self-hostable, public or single-tenant caching proxy and credential broker for [`forges`](https://forges.link): one API, one cache, and one set of credentials in front of every forge you configure. Callers authenticate to the proxy; it holds the forge tokens. Design in [ARCHITECTURE.md](./ARCHITECTURE.md), next steps in [PLAN.md](./PLAN.md).

## Use cases

- Non-JS clients, using `forges` over HTTP, as a sidecar or a separate gateway service.
- Internal tools, bots, and CI across several forges: credentials in one place, rate limits pooled behind one cache.
- Public read-only services like [npmx](https://npmx.dev), where many readers to many forges share one cache.
- Browsers and sandboxes limited to known hosts (CSP, egress allowlists) reaching forges whose hosts aren't known in advance: Tangled reads hit each author's server and per-repo knots, and self-hosted forges and Radicle nodes can be anywhere.
- AI agents that need forge access without holding tokens.

## Packages

- [`packages/server`](packages/server) (`@forges-proxy/server`): the proxy as a [Fetchable](https://fetchable.org). `createServer(options)` returns `{ fetch(request) }`, and the default export is one configured from `process.env`.
- [`packages/client`](packages/client) (`@forges-proxy/client`): `connect()`, which turns a proxy back into drop-in `forges` providers.
- [`packages/docs`](packages/docs): placeholder for the documentation site.
- [`demos/`](demos): one deployment per platform, each a few lines: [Netlify Functions](demos/netlify-serverless) (canonical), [Netlify Edge Functions](demos/netlify-edge), [Cloudflare Workers](demos/cloudflare-workers), [Vercel](demos/vercel), [Node](demos/node), [Docker](demos/docker), and mounted under `/forges` in [Hono](demos/hono), [Nitro](demos/nitro) and [Fastify](demos/fastify).

## Deploy

Depend on `@forges-proxy/server` and hand it to your platform. Updating is a version bump. Where the platform takes a Fetchable, this is the whole entry:

```ts
export { default } from "@forges-proxy/server"
```

Platform specifics are options. On Netlify (see the demo):

```ts
import { cacheApiStore, createServer } from "@forges-proxy/server"
import { purgeCache } from "@netlify/functions"

export default createServer({
  upstreamStore: cacheApiStore(() => caches.open("upstream")),
  purge: (tags) => purgeCache({ tags }),
  cdnHeaders: ({ cacheControl, tags }) => ({
    "netlify-cdn-cache-control": `${cacheControl}, durable`,
    "netlify-cache-tag": tags.join(","),
  }),
})
export const config = { path: "/*" }
```

The proxy answers at its own root. To mount it under a path, strip the prefix first (Hono's `app.mount()` does). The client, docs and OpenAPI document all work under a prefix.

Check a deployment end to end with `pnpm smoke <url> [secret]`.

## Configure

Providers come from `FORGES_<KIND>_<FIELD>[_<SUFFIX>]` variables, as `forgesFromEnv()` reads them (e.g. `FORGES_GITHUB_TOKEN`, `FORGES_GITLAB_ENABLED=1`). With `createServer({ anonymousForges: true })`, every forge the env doesn't mention that can be read without credentials is served too, anonymously: GitHub, GitLab, Codeberg, gitea.com, Bitbucket, Gitee, Cursor Origin and Pushin today. Tangled is left out: its reads go to hosts callers name, so it would let anyone aim the proxy at any host. The demos turn it on.

Set exactly one of:

- `FORGES_PROXY_SECRET`: private instance. Callers send `Authorization: Bearer <secret>` to everything but `/docs`, `/openapi.json` and webhooks. Every verb is routed.
- `FORGES_PROXY_PUBLIC=1`: public instance. No auth, and only reads that need neither an account nor elevated access are routed (no writes, no security alerts, collaborators or admin settings). Still, give it tokens that can only read public data, e.g. a GitHub fine-grained token limited to public repositories.

## Use

```sh
pnpm install
pnpm build
pnpm --filter @forges-proxy/server dev
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

`@forges-proxy/client` turns the proxy back into `forges` providers, so code written against `forges` works unchanged:

```ts
import { createForges } from "forges"
import { connect } from "@forges-proxy/client"

const forges = createForges(await connect({ url: "https://forges.example.com", secret }))
const repo = await forges.repos.get({
  forge: "github",
  instance: "github.com",
  owner: "danielroe",
  name: "forges",
})
```

Every verb is present. Listings read one page per request, whether iterated or through `page()`. Errors come back as the same classes. Verbs the proxy doesn't route reject with `UnsupportedOperationError`, and `can()` says so.

## Webhooks and purging

Point a forge's webhook at `/webhooks/:forge/:instance` and set the provider's `FORGES_<KIND>_WEBHOOK_SECRET`. Each verified delivery expires the upstream cache and, with a `purge` option (the Netlify Functions demo passes Netlify's), purges the CDN entries of every repository it concerns by cache tag. Without one, CDN entries expire by age: fresh for 60 seconds, then served stale for up to 10 minutes while they refresh.

## Upstream cache

The proxy keeps upstream JSON responses and revalidates them with their `etag`, so a CDN miss usually costs a `304` (free on GitHub's rate limit when authenticated) or nothing. By default they're in memory. With `upstreamStore: cacheApiStore(...)` on a platform with the Cache API (Netlify Functions, Cloudflare Workers), every instance in a region shares them, and the same cache tags purge them. While upstream is rate-limited or failing, a stored response stands in for up to a day past its freshness. Each response's `x-upstream-cache` header says what happened to its upstream requests: `fresh`, `revalidated`, `fetched` or `stale`.

## Operations manifest

`packages/server/src/manifest.json` describes every routed verb: parameters, result and docs, as JSON Schemas read from the `forges` types. The OpenAPI document, argument validation and signal passthrough all come from it. Regenerate it after changing `forges`:

```sh
pnpm --filter @forges-proxy/server manifest
```

A test fails while it's stale.
