# Architecture

`forges-proxy` is a single-tenant HTTP service that exposes `forges` providers over HTTP. Provider
credentials and access mode are configured via environment variables, platform-specific hooks are
passed to `createServer()`, and public read responses are cached by the CDN in front of the proxy.

## Request path

```
client ──▶ CDN ──▶ auth middleware ──▶ verb route ──▶ forges provider ──▶ forge API
           (tags,    (secret, or       (validate,
            ETag)     public mode)      call, tag)
```

- **CDN**: Public reads return `CDN-Cache-Control` (60s fresh, 10m stale-while-revalidate), a weak
  `ETag`, and `Cache-Tag` headers (or custom headers from `cdnHeaders`, such as Netlify's `durable`
  directive). Private instances and write requests return `Cache-Control: private, no-store`.
- **Verb route** (`packages/server/src/routes/verb.ts`): Validates `args` against the schema from
  `forges/schema`, decodes wire-encoded dates and bytes, injects the request's `AbortSignal` into
  the verb's options argument, invokes the provider method, and tags the response with every
  repository referenced in the arguments or response payload.
- **Event stream** (`GET /:forge/:instance/sources.stream`): Exposes `provider.sources.stream()` as
  Server-Sent Events. Handled outside the JSON verb manifest because it returns an event stream.
  Each event's `id` is its cursor so standard SSE clients resume automatically. Never cached.
- **Webhooks** (`POST /webhooks/:forge/:instance`): Verifies the webhook signature via
  `provider.webhooks.ingest()`, computes affected repository tags via `affectedKeys()`, calls the
  deployment's `purge` hook, and awaits `handleEvents`. If `handleEvents` throws, the route returns
  `500` so the failure is visible in the forge's webhook delivery log.
- **Operations manifest** (`packages/server/src/manifest.ts`): Re-exports routable verbs and model
  schemas from `forges/schema`. Drives routing, argument validation, `AbortSignal` injection,
  `GET /`, `/openapi.json`, and `/docs`.
- **Client** (`@forges-proxy/client`): `discoverProviders()` fetches `GET /`, verifies that the
  server's `forges` version is wire-compatible, and constructs local `ForgeProvider` proxies using
  the verb metadata returned by `/`. `proxyProvider()` constructs a single forge's provider
  synchronously without fetching `/`, using built-in verb metadata (with options parameter indices
  verified against `forges/schema`) and assuming full capability support until
  `refreshCapabilities()` is called.

## Decisions

### Library package deployed via thin platform wrappers

`@forges-proxy/server` exports `createServer(options)`, which returns a standard
[Fetchable](https://fetchable.org) (`{ fetch }`), plus a default export preconfigured from
`process.env`. Users deploy a thin wrapper that imports the package rather than forking a server
repo, so upgrading is a dependency bump.

The core package contains no platform-specific code. Platform integration points (CDN cache header
names via `cdnHeaders`, cache-tag purging via `purge`, and custom upstream `fetch`) are passed as
options to `createServer()`. `demos/` contains working deployments for each target platform, tested
with `pnpm smoke <url>`.

The server is built on [h3](https://h3.dev) and bundled with tsdown, keeping `forges` as a normal
dependency. We replaced an earlier Nitro setup because routing only required a few `app.get()`
calls, Fetchable entrypoints made Nitro platform presets redundant, and bundling the server would
have pinned `forges`. Both `@forges-proxy/server` and `@forges-proxy/client` use `forges/wire` for
date and byte serialization.

### Single-tenant credentials from environment variables

Forge credentials are loaded from `FORGES_*` environment variables via `providersFromEnv()`; callers
never pass forge tokens to the proxy. Setting `anonymousForges: true` enables any unconfigured forge
that supports anonymous reads at its default host by probing `FORGES_<KIND>_ENABLED=1`. Tangled is
excluded from anonymous defaults because its reads fetch hosts specified in caller arguments
(`did:web:`), which would allow SSRF without an egress allowlist.

Access is controlled by setting either `FORGES_PROXY_SECRET` (private mode, with optional
`FORGES_PROXY_PREVIOUS_SECRET` for zero-downtime key rotation) or `FORGES_PROXY_PUBLIC=1` (public
mode). Setting both or neither returns `503` so misconfigured deployments fail closed.

In public mode, write verbs, account verbs, and privileged read verbs (`PRIVILEGED` in `verbs.ts`)
are not routed; calling one returns `501` with `UnsupportedOperationError`, matching direct provider
behavior. Any tokens configured on a public instance must be restricted to public data.
Additionally, when a public instance uses an authenticated provider, it HMAC-signs `cursor.nextUrl`
on outgoing listing pages and rejects unsigned `nextUrl` values on incoming requests (`cursors.ts`,
keyed via HKDF from the configured `FORGES_*` credentials so all serverless instances derive the
same key). This prevents callers from supplying an arbitrary forge API path in `nextUrl` and reading
it with the proxy's token.

### RPC over `ForgeProvider` methods instead of custom REST routes

Reads use `GET /:forge/:instance/:verb?args=<json array>` and writes use `POST` with
`{ "args": [...] }`. Arguments are positional to match the underlying `ForgeProvider` method. Verb
metadata (`write`, `account`, `listing`, parameter schemas) comes directly from `forges/schema`, so
new verbs in `forges` require no routing code in the proxy.

Listing calls execute `.page()` for the requested cursor and return a single page; the client
reconstructs the async iterable with `iteratePages`. `provider.request` (which accepts arbitrary
URLs), `installations.token`, and `installations.provider(s)` are excluded from routing.

Wire encoding:

- Skipped optional positional arguments are encoded as `null`.
- `Uint8Array` values use `{ "$bytes": "<base64>" }` and `Date` values use
  `{ "$date": "<ISO 8601>" }`.
- Model `raw` payloads are stripped unless `?raw=1` is passed.
- `undefined` results return `204 No Content`; `ReadableStream` results return
  `application/octet-stream`.
- Errors return `{ "error": { name, message, ...fields } }` and are rehydrated into the matching
  `ForgeError` subclass by the client.

### Provider RPC vs. transparent forge HTTP pass-through

**Context**: Running `forges` on both the server and client (`discoverProviders()`) requires both
sides to use a compatible `forges` version (`GET /` advertises the version and `discoverProviders()`
throws on mismatch). An alternative is running `forges` only in the client and making the proxy a
transparent, authenticating HTTP forwarder for upstream forge APIs.

**Pass-through shape**: The client configures `forges` providers with a custom `fetch` that rewrites
upstream URLs onto the proxy (e.g. `https://api.github.com/repos/a/b` ->
`https://proxy.example/api.github.com/repos/a/b`, rather than overriding `baseUrl`, which would
corrupt parsed refs and web URLs). The proxy checks an allowlist of configured upstream hosts,
injects the token, and sets CDN cache headers.

**Tradeoffs of pass-through**:

- _Pros_: `forges` runs only on the client (no version coupling, no manifest, no
  `discoverProviders()`), `provider.request` works against allowlisted hosts, and non-JS callers use
  native forge APIs.
- _Cons_:
  - Public read-only mode would need per-forge request inspection to block writes and private
    endpoints. HTTP method checks aren't enough because GitHub reads like discussion listings use
    GraphQL `POST` requests, requiring the proxy to parse GraphQL ASTs to block mutations.
  - CDNs do not cache `POST` requests by default, breaking CDN caching for GraphQL reads.
  - Cache tags would have to be parsed out of forge-specific URL patterns instead of normalized
    `RepoRef` objects.
  - Multi-request verbs would require multiple client round-trips instead of one call.
  - We would lose normalized responses (increasing payload sizes), input schema validation, and the
    unified OpenAPI spec / `/docs`.

**Decision**: Keep the RPC design. Public read-only instances, CDN caching for GraphQL-backed reads,
single-round-trip fan-out, and a unified HTTP API for non-JS callers all depend on verb-level
routing.

### No URL version prefix

Routes are mounted at `/:forge/:instance/:verb` without a `/v1` prefix. Because the HTTP surface
mirrors `forges` directly, its contract is tied to the `forges` package version rather than an
independent HTTP API version. Auth middleware protects all routes by default except `/docs`,
`/openapi.json`, and `POST /webhooks/:forge/:instance`.

### Stateless CDN caching

The proxy does not maintain an in-process cache. It emits `Cache-Control`, `CDN-Cache-Control`,
`Cache-Tag`, and weak `ETag` headers so the platform CDN handles caching and revalidation.

### Rate limiting is the platform's job

Protecting public instances from abusive callers requires shared state at the edge before invoking
the proxy. Per-IP or per-caller rate limiting is left to the hosting platform or reverse proxy in
front of `@forges-proxy/server`.

### Client-side registry fan-out (no `/_all/...` route)

**Context**: The `Forges` registry provides cross-provider methods: `search.threads`,
`search.repos`, and `notifications.list` merge results across providers by date, and
`threads.getMany` batches refs by provider.

**Decision**: Do not expose server-side `/_all/*` routes. Clients perform fan-out locally by passing
the remote providers to `createForges(await discoverProviders(...))`.

**Rationale**:

- Merged listings return async iterables rather than pages. Paginating a merged stream over
  stateless HTTP requires a composite cursor encoding every provider's cursor plus buffer offsets.
- A merged response depends on all queried providers, so its cache entry would carry tags from every
  provider and be invalidated whenever any of them changed. Per-provider page requests cache
  independently and share cache entries with single-provider calls.
- Running `createForges()` on the client reuses `forges`'s exact merging logic.

**Tradeoff**: Cross-provider queries make one request per provider per page from the client, and
non-TS HTTP clients have to query providers individually.

**Revisit if**: Browser latency from multi-provider fan-out becomes a bottleneck (e.g. in npmx), or
non-TS consumers need server-side cross-forge search.

### No built-in upstream HTTP cache

An earlier version included a 360-line ETag-revalidating upstream `fetch` cache backed by the Web
Cache API or memory. It was removed because in-memory caches are cold on serverless platforms,
Cloudflare's Cache API requires a custom domain, and CDN response caching already absorbs repeated
public reads. Deployments that want upstream response caching can pass a custom `fetch` to
`createServer({ fetch })`.

### Manifest sourced from `forges/schema`

`packages/server/src/manifest.ts` imports `verbs` and `models` directly from `forges/schema`, and
both client and server use `forges/wire` for date and binary encoding. No code generation step is
needed in this repo.
