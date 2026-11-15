# Architecture

A self-hostable, single-tenant service that exposes `forges` providers over HTTP. Providers and access come from the environment; platform specifics come from the deployment's options. It caches at the CDN.

## Request path

```
client ──▶ CDN ──▶ auth middleware ──▶ verb route ──▶ forges provider ──▶ forge API
           (tags,    (secret, or       (validate,                        (Cache API or
            ETag)     public mode)      call, tag)                        memory)
```

- **CDN.** Public reads carry `CDN-Cache-Control` (60 s fresh, 10 min stale-while-revalidate), a weak `ETag`, and `Cache-Tag`, or whatever the deployment's `cdnHeaders` returns instead (the Netlify demos add `durable`). Private instances and writes are `private, no-store`.
- **Verb route** (`packages/server/src/routes/verb.ts`). Checks the arguments against the operations manifest, decodes dates and bytes, passes the request's signal into the verb's options, calls the provider, and tags the response with every repository in its arguments and result.
- **Event stream** (`GET /:forge/:instance/sources.stream`). The provider's `sources.stream()` as server-sent events, outside the manifest since it answers with a stream rather than JSON. Cursors are the event ids, so `EventSource` resumes on its own. Never cached.
- **Webhooks** (`POST /webhooks/:forge/:instance`). Verified by the provider and turned into repository tags with `affectedKeys()`. Purges the tags through the deployment's `purge` option, then awaits its `handleEvents` with the events. A failure answers 500, so the forge's delivery log shows it.
- **Operations manifest** (`packages/server/src/manifest.ts`). Re-exports the routed verbs and model schemas from `forges/schema`. The server's only list of verbs: it drives routing, validation, the signal passthrough, `/`, `/openapi.json`, and `/docs`.
- **Client** (`@forges-proxy/client`). `connect()` turns a proxy back into `ForgeProvider`s, finding each verb's options where `/` says they are. It warns when `/` reports an incompatible `forges` version.

## Decisions

### Published as a package, deployed by a wrapper

The server is the `@forges-proxy/server` package: `createServer(options)` returns a [Fetchable](https://fetchable.org) (`{ fetch }`), and the default export is one configured from `process.env`. Deployments depend on it and hand it to their platform, so updates are a version bump rather than merging upstream into a fork.

Nothing in the package names a platform. Anything platform-specific is an option the deployment passes: CDN header names (`cdnHeaders`), purging (`purge`) and the providers' HTTP requests (`fetch`). Each demo in `demos/` is a deployment, smoke-tested through the client with `pnpm smoke <url>`.

It's plain [h3](https://h3.dev), built with tsdown, with `forges` as a regular dependency. We dropped Nitro: its file routing was ten lines of `app.get()`, its presets only wrote platform entries a Fetchable doesn't need, and bundling a library would have pinned `forges`. Both packages use `forges/wire` for dates and bytes, and the server reports the `forges` version it runs against.

### Single tenant, credentials only in the environment

Forge credentials come from `FORGES_*` variables via `providersFromEnv()`; callers never send forge tokens. `anonymousForges` adds every forge the env doesn't mention that `forges` can read without credentials, by trying `ENABLED` for each and keeping what builds. Tangled is excluded: its reads fetch hosts named by caller data (`did:web:`), which is SSRF without an egress allowlist. Access is either a bearer secret (`FORGES_PROXY_SECRET`, private, with `FORGES_PROXY_PREVIOUS_SECRET` also accepted during a rotation) or public mode (`FORGES_PROXY_PUBLIC=1`), which routes no write or account verbs, nor reads that need elevated access (`PRIVILEGED` in `verbs.ts`). Both or neither is a 503, so a misconfigured instance fails closed.

### RPC over the provider surface, not REST

`GET /:forge/:instance/:verb?args=<json array>` for reads, `POST` with `{ "args": [...] }` for writes. Arguments are positional, as the method takes them. Verb classes (write, account, listing) come from `forges/schema`, so new verbs need no proxy change. A listing answers with the page its options' `cursor` names (`listing.page()`); clients rebuild the iterable with `iteratePages`. `provider.request` (takes absolute URLs, so SSRF), `installations.token`, and `installations.provider(s)` are never routed.

On the wire: `null` for a skipped optional argument, bytes as `{ "$bytes": "<base64>" }`, dates as `{ "$date": "<ISO 8601>" }`, `raw` dropped unless `?raw=1`, `undefined` as 204, streams as `application/octet-stream`. Errors are `{ "error": { name, message, ...fields } }`, which the client rebuilds into the `ForgeError` class.

### RPC, not a transparent forge-API proxy

**Context.** The RPC design runs `forges` twice, in the proxy and in the client (`connect()`), and the two must agree on its version: the proxy reports it in `GET /` and `connect()` warns on a mismatch. The alternative runs `forges` only in the client and makes the proxy a caching, credential-adding pass-through for each forge's own API.

**Shape.** The client passes a `fetch` that rewrites forge URLs onto the proxy, e.g. `github({ fetch: via("https://proxy.example") })` sending `https://api.github.com/repos/a/b` as `/api.github.com/repos/a/b`. Not `baseUrl`: `forges` derives the instance from it, so refs, keys, and web links would name the proxy's host. The proxy forwards to an allowlist of configured hosts (otherwise it's an open proxy), adds the token, and keeps the CDN and webhook purging.

**Gains.**

- One `forges`, in the client: no version mismatch, no `connect()`, no manifest or generator.
- Every request-based verb works, `provider.request` too within the allowlisted hosts, and new `forges` verbs need nothing here. WebSocket sources would still need their own route.
- Non-JS callers get each forge's documented API rather than a positional-args RPC.

**Costs.**

- Public mode needs per-forge rules for which requests are reads and need no account, instead of the manifest's verb classes. Methods help (GET is a read) but not entirely: GitHub reads like discussion listings are GraphQL `POST`s, so the proxy would parse documents to refuse mutations.
- GraphQL reads are `POST`s, which CDNs don't cache.
- Cache tags come from URL paths per forge (`/repos/:owner/:name/...` on GitHub) rather than refs in arguments and results.
- A verb that makes several upstream requests is several browser round trips instead of one call, each through the CDN.
- Argument validation, the OpenAPI document, and `/docs` go away.
- Responses are each forge's raw payloads, so the CDN stores more and browsers download more than the normalized models.

**Decision.** RPC. Public read-only instances and non-JS callers need the proxy to know verbs, and a verb's upstream fan-out should stay one call from the app.

### No version prefix

Routes sit at the root (`/:forge/:instance/:verb`), not under `/v1`. The API mirrors the `forges` provider surface, so it changes when `forges` does and a path prefix couldn't stay stable on its own; releases carry the version instead. Auth guards everything but `/docs`, `/openapi.json` and webhooks, so a new route is private by default.

### HTTP caching first

Caching is response headers, so the CDN does the work. The proxy stores nothing itself.

### Rate limiting is the platform's job

Public instances need protecting from callers who burn the forge budget. Per-client throttling is left to the platform or whatever sits in front: it sees clients before the proxy runs, and needs no state here.

### No registry-level fan-out route (`/_all/...`)

**Context.** The `Forges` registry has methods that span providers: `search.threads`, `search.repos`, and `notifications.list` merge every provider's results by date, and `threads.getMany` splits refs by provider. The rest of the registry routes by ref, which the per-provider routes already cover.

**Decision.** No server-side route for them. Clients get fan-out by registering the remote providers: `createForges(await connect(...))`.

**Why.**

- The merged listings exist only as iterables. Paging them over HTTP needs a composite cursor: every provider's cursor and how far into its buffered page the merge got. Stateless is possible, but it's new code to get right.
- A merged page depends on every provider, so it carries all their tags and is purged by a change in any of them. Per-provider pages cache on their own and are shared with plain reads.
- Client-side fan-out is `forges` itself, so its behaviour can't drift.

**Costs.** One request per provider per page instead of one, which matters to a browser on a slow connection. Non-TypeScript clients (curl, other languages, anything generated from the OpenAPI document) get no fan-out.

**Revisit if** npmx needs fewer browser round trips, or a non-TypeScript consumer needs cross-forge search. The shape would be `GET /_all/search.threads?args=...` with a base64 JSON cursor of per-provider cursors and offsets, and `POST /_all/threads.getMany`.

### No built-in upstream cache

**Context.** The proxy had an etag-revalidating upstream cache, with stale-if-error and a shared Cache API store tagged for purging: about 360 lines, a second cache under the CDN. On serverless an in-memory store is mostly cold, and the shared store needs a custom domain on Workers.

**Decision.** Removed. The CDN absorbs repeated public reads. A deployment that needs fewer upstream requests passes its own `fetch` as `upstream`.

**Revisit if** a deployment runs out of upstream rate limit despite the CDN.

### Manifest from `forges/schema`

The server imports `verbs` and `models` from `forges/schema`; there is no proxy-side generator. `forges/wire` provides the tagged dates and bytes used on every request and response, so the client and server share one codec.
