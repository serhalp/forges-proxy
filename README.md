# forges-proxy

A self-hostable, public or single-tenant caching proxy and credential broker for [`forges`](https://forges.link): one API, one cache, and one set of credentials in front of every forge you configure. Callers authenticate to the proxy; it holds the forge tokens. Design in [ARCHITECTURE.md](./ARCHITECTURE.md), next steps in [PLAN.md](./PLAN.md).

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/server-dark.png">
  <img alt="@forges-proxy/server: self-hosted API gateway for code forges. Web apps (even under a strict CSP or for forge APIs without CORS), CI and bots, AI agents, and any language call your deployment. Behind a cache, it holds the forge tokens, caches responses, rate-limits per caller and per route, and serves one typed API for 14 forges, whose webhooks purge affected cache entries and run your own handler." src="assets/server-light.png">
</picture>

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
- [`demos/`](demos): one deployment per platform, each a few lines: [Netlify Functions](demos/netlify-serverless) (canonical), [Netlify Edge Functions](demos/netlify-edge), [Netlify Server](demos/netlify-server), [Cloudflare Workers](demos/cloudflare-workers), [Vercel](demos/vercel), [Node](demos/node), [Docker](demos/docker), and mounted under `/forges` in [Hono](demos/hono), [Nitro](demos/nitro), and [Fastify](demos/fastify).
  Live, as public read-only instances: [Netlify Functions](https://forges-proxy-demo.netlify.app/), [Netlify Edge Functions](https://forges-proxy-edge-demo.netlify.app/), [Netlify Server](https://forges-proxy-server-demo.netlify.app/), [Cloudflare Workers](https://demo.forges-proxy.workers.dev/), [Vercel](https://forges-proxy-demo.vercel.app/), [Docker on Fly.io](https://forges-proxy-demo.fly.dev/).

## Deploy

Depend on `@forges-proxy/server` and hand it to your platform. Updating is a version bump. Where the platform takes a Fetchable, this is the whole entry:

```ts
export { default } from "@forges-proxy/server"
```

Platform specifics are options. On Netlify (see the demo):

```ts
import { createServer } from "@forges-proxy/server"
import { purgeCache } from "@netlify/functions"

export default createServer({
  purge: (tags) => purgeCache({ tags }),
  cdnHeaders: ({ cacheControl, tags }) => ({
    "netlify-cdn-cache-control": `${cacheControl}, durable`,
    "netlify-cache-tag": tags.join(","),
  }),
})
export const config = { path: "/*" }
```

The proxy answers at its own root. To mount it under a path, strip the prefix first (Hono's `app.mount()` does). The client, docs, and OpenAPI document all work under a prefix.

Check a deployment end to end with `pnpm smoke <url> [secret]`.

## Configure

Providers come from `FORGES_<KIND>_<FIELD>[_<SUFFIX>]` variables, as `forgesFromEnv()` reads them (e.g. `FORGES_GITHUB_TOKEN`, `FORGES_GITLAB_ENABLED=1`). With `createServer({ anonymousForges: true })`, every forge the env doesn't mention that can be read without credentials is served too, anonymously: GitHub, GitLab, Codeberg, gitea.com, Bitbucket, Gitee, Cursor Origin, Pushin, GitCafe, and Upstream today. Tangled is left out: its reads go to hosts callers name, so it would let anyone aim the proxy at any host. The demos turn it on.

Set exactly one of:

- `FORGES_PROXY_SECRET`: private instance. Callers send `Authorization: Bearer <secret>` to everything but `/docs`, `/openapi.json`, and webhooks. Every verb is routed. To rotate it without downtime, move the old one to `FORGES_PROXY_PREVIOUS_SECRET`, set the new one, and unset the old one once every caller has moved over; both are accepted meanwhile.
- `FORGES_PROXY_PUBLIC=1`: public instance. No auth, and only reads that need neither an account nor elevated access are routed (no writes, no security alerts, collaborators, or admin settings). Its forge tokens must only be able to read public data, e.g. a GitHub fine-grained token limited to public repositories.

## Use

```sh
pnpm install
FORGES_PROXY_PUBLIC=1 FORGES_GITHUB_ENABLED=1 pnpm --filter @forges-proxy/server dev
```

This serves GitHub anonymously, on a public instance. Add `FORGES_GITHUB_TOKEN` for a higher rate limit, or see [Configure](#configure).

- `GET /`: configured providers, their capabilities (refined by each instance's version, once per server instance), and the routed verbs with the position of their options.
- `GET /docs`: API reference (Scalar), from `GET /openapi.json` (OpenAPI 3.1).
- `GET /status`: each provider's rate-limit budgets, as the server instance that answers last saw them. Verb responses carry the same in a `forges-rate-limits` header.
- `GET /:forge/:instance/:verb?args=<json array>`: a read, e.g. `repos.get`, `threads.list`.
- `POST /:forge/:instance/:verb` with `{ "args": [...] }`: a write.
- `GET /:forge/:instance/sources.stream`: the forge's live events (`sources.stream()`, Tangled only today) as [server-sent events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events). Each event's `id` is its cursor; resume with `Last-Event-ID`, as `EventSource` does on reconnect, or `?cursor=`. A failure ends the stream with an `error` event. Serverless platforms end long responses at their time limit, so expect to reconnect. Browsers' `EventSource` can't send the proxy secret, so on a private instance use the client or `fetch`.

Arguments are positional, as the `ForgeProvider` method takes them, and are validated against the verb's signature (see `/docs`). Pass `null` for a skipped optional argument. Bytes travel as `{ "$bytes": "<base64>" }` in both directions. A listing answers with one page; pass its `cursor` back, unchanged, in the options to read the next. Public instances sign a cursor's `nextUrl` and refuse one they didn't sign.

```sh
curl -G localhost:3000/github/github.com/repos.get \
  --data-urlencode 'args=[{"forge":"github","instance":"github.com","owner":"danielroe","name":"forges"}]'
```

## Client

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/client-dark.png">
  <img alt="@forges-proxy/client: drop-in forges providers for your proxy. Without a proxy, createForges() holds a GitHub, GitLab, and Gitea token and calls each forge directly. With the proxy, createForges(await connect({ url, secret })) sends each call with the proxy secret to @forges-proxy/server, which calls the same forges with their tokens." src="assets/client-light.png">
</picture>

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

For the sync helpers (`urlFor()`, `parseUrl()`, ...), pass the factories of the forges you use, such as `connect({ url, secret, factories: [github] })` with `github` from `forges/github`, or every forge's with `allFactories` from `@forges-proxy/client/all`. Without one, a forge's helpers return nothing, and your bundle carries none of its code.

Every verb is present. Listings read one page per request, whether iterated or through `page()`. `sources.stream()` follows the proxy's event stream and, as with any provider, ends with `StreamClosedError` and the last cursor when the connection closes, including at a serverless time limit; call it again with that cursor. Errors come back as the same classes. Verbs the proxy doesn't route reject with `UnsupportedOperationError`, and `can()` says so. `refreshCapabilities()` re-reads the proxy's capabilities.

`rateLimits()` returns the budgets reported with the provider's latest response, which are the proxy's, not the client's. Read them with these caveats:

- They're the budgets of the server instance that answered, as of its latest upstream response. Instances of a serverless deployment each keep their own.
- An authenticated budget is the forge account's (on GitHub, the user's or the app installation's), shared with anything else using it. An anonymous budget is usually the server's IP's, which can differ between instances.
- A response the CDN served carries the budgets from when it was cached.
- Limits the forge doesn't report in headers, such as GitHub's secondary limits, aren't in them.

## Webhooks

A forge's webhooks, pointed at the proxy, keep its cache fresh and hand the forge's events to your code.

Without webhooks, CDN entries expire by age: fresh for 60 seconds, then served stale for up to 10 minutes while they refresh. With them, and a `purge` option (the Netlify Functions and Netlify Server demos pass Netlify's), each verified delivery purges the CDN entries of every repository it concerns, by cache tag.

With a `handleEvents` option, the proxy then calls it with the delivery's events, normalized as `forges` [`ForgeEvent`s](https://forges.link/concepts/events), and the forge and instance that sent them:

```ts
createServer({
  handleEvents: async (events, { forge, instance }) => {
    await queue.send(events)
  },
})
```

The response waits for it. If it throws, the forge gets a `500` and logs the delivery as failed; most forges don't retry on their own, so redeliver it from the forge's settings or with `webhooks.redeliver()`, which private instances route too. Forges give up after a few seconds (GitHub after 10), so hand slow work to a queue or to your platform's `waitUntil` (on Workers, `import { waitUntil } from "cloudflare:workers"`). The demos log each event.

To set one up:

1. Pick a secret and set it as the provider's `FORGES_<KIND>_WEBHOOK_SECRET`, e.g. `FORGES_GITHUB_WEBHOOK_SECRET`. The provider has to exist: on a public instance with no token, also set `FORGES_<KIND>_ENABLED=1`, since setting any `FORGES_<KIND>_*` variable turns off its anonymous default. Redeploy if your platform reads the env at deploy time.
2. On the forge, add a webhook to the repository or organization with the URL `https://<proxy>/webhooks/<forge>/<instance>` (e.g. `/webhooks/github/github.com`), the same secret, a JSON payload, and the events you read or handle. Every event that names a repository purges it, so subscribing to everything is simplest for caching. Or create it from code with [`webhooks.create()`](https://forges.link/guides/webhooks#register-a-webhook).
3. Check the forge's delivery log. A verified delivery answers `200` with the tags it purged (`{ "purged": [...] }`); a bad signature answers `401`, and a forge or instance the proxy doesn't serve `404`.

Webhook URLs need no proxy secret; the forge's signature is what authenticates them. For what each forge sends and signs, and which events it can deliver, see the `forges` [webhooks guide](https://forges.link/guides/webhooks) and its [provider pages](https://forges.link/providers).

## Upstream requests

The CDN absorbs repeated public reads; each miss is a request upstream. To cache upstream responses as well, pass your own `fetch`.

## Logging

By default the server logs only its own failures, such as a verb's unexpected error or a `handleEvents` that throws, to `console.error`. Pass a `logger` to choose where logs go, and to log each request at info: `{ message: "request", method, path, status, durationMs }`. Anything with `error()` and, optionally, `info()` methods that take an object fits, such as `console`, pino, or [evlog](https://evlog.dev)'s `log`; its levels decide what's kept. Pass the logger itself rather than its methods, so it keeps its `this`. Reads the CDN answers never reach the server, so they aren't logged. The platform and Docker demos use evlog.

## Operations manifest

`packages/server/src/manifest.ts` re-exports the routed verbs and model schemas from `forges/schema`. The OpenAPI document, argument validation, and signal passthrough all come from it. Update the `forges` dependency to pick up new verbs; there is no proxy-side generator.
