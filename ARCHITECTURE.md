# Architecture

A self-hostable, single-tenant HTTP service that exposes `forges` providers over HTTP, configured entirely from its environment, and caches what it can at every layer.

## Request path

```
client ──▶ CDN ──▶ auth middleware ──▶ verb route ──▶ forges provider ──▶ upstream cache ──▶ forge API
           (tags,    (secret, or       (validate,                        (Cache API or
            ETag)     public mode)      call, tag)                        memory)
```

- **CDN.** Public reads carry `CDN-Cache-Control` / `Netlify-CDN-Cache-Control` (60 s fresh, 10 min stale-while-revalidate, durable), a weak `ETag`, and `Netlify-Cache-Tag`. Private instances and writes are `private, no-store`.
- **Verb route** (`server/routes/[forge]/[instance]/[verb].ts`). Checks the arguments against the operations manifest, revives dates and bytes, passes the request's signal into the verb's options, calls the provider and tags the response with every repository in its arguments and result.
- **Upstream cache** (`server/utils/upstream-cache.ts`). A `fetch` wrapper given to every provider. It serves fresh JSON, revalidates stale JSON with `If-None-Match` (a GitHub 304 is free for authenticated requests), and stands in with a stored response while upstream is rate-limited or failing. Entries carry the proxy response's tags, so a purge reaches them too.
- **Webhooks** (`POST /webhooks/:forge/:instance`). Verified by the provider, turned into repository tags with `affectedKeys()`, purged from the Netlify CDN and the upstream cache.
- **Operations manifest** (`server/manifest.json`, from `scripts/generate-manifest.ts`). Each routed verb's parameters, result and docs as JSON Schemas, read from the `forges` types. The server's only list of verbs: it drives routing, validation, the signal passthrough, `/`, `/openapi.json` and `/docs`.
- **Client** (`client/remote.ts`). `connect()` turns a proxy back into `ForgeProvider`s, finding each verb's options where `/` says they are. Shares the bytes encoding with the server (`shared/wire.ts`).

## Decisions

### Single tenant, credentials only in the environment

Forge credentials come from `FORGES_*` variables via `providersFromEnv()`; callers never send forge tokens. Access is either a bearer secret (`FORGES_PROXY_SECRET`, private) or public mode (`FORGES_PROXY_PUBLIC=1`), which routes no write or account verbs. Both or neither is a 503, so a misconfigured instance fails closed.

### RPC over the provider surface, not REST

`GET /:forge/:instance/:verb?args=<json array>` for reads, `POST` with `{ "args": [...] }` for writes. Arguments are positional, as the method takes them. The manifest generator takes verbs and their classes (write, account, listing) from `CAPABILITY_TABLE`, so new verbs need no proxy change beyond regenerating it. A listing answers with the page its options' `cursor` names (`listing.page()`); clients rebuild the iterable with `iteratePages`. `provider.request` (takes absolute URLs, so SSRF), `installations.token` and `installations.provider(s)` are never routed.

On the wire: `null` for a skipped optional argument, bytes as `{ "$bytes": "<base64>" }` both ways (a bare string is text where a field takes either), `raw` dropped unless `?raw=1`, `undefined` as 204, streams as `application/octet-stream`. Errors are `{ "error": { name, message, ...fields } }`, which the client rebuilds into the `ForgeError` class.

### Under consideration: a transparent forge-API proxy instead of RPC

**Context.** The RPC design runs `forges` twice, in the proxy and in the client (`connect()`), and the two must agree on its version: the proxy reports it in `GET /` and `connect()` warns on a mismatch. The alternative runs `forges` only in the client and makes the proxy a caching, credential-adding pass-through for each forge's own API.

**Shape.** The client passes a `fetch` that rewrites forge URLs onto the proxy, e.g. `github({ fetch: via("https://proxy.example") })` sending `https://api.github.com/repos/a/b` as `/api.github.com/repos/a/b`. Not `baseUrl`: `forges` derives the instance from it, so refs, keys and web links would name the proxy's host. The proxy forwards to an allowlist of configured hosts (otherwise it's an open proxy), adds the token, and keeps the CDN, upstream cache, stale-if-error and webhook purging.

**Gains.**

- One `forges`, in the client: no version mismatch, no `connect()`, no manifest or generator.
- Every request-based verb works, `provider.request` too within the allowlisted hosts, and new `forges` verbs need nothing here. WebSocket sources would still need their own route.
- Non-JS callers get each forge's documented API rather than a positional-args RPC.

**Costs.**

- Public mode needs per-forge rules for which requests are reads and need no account, instead of the manifest's verb classes. Methods help (GET is a read) but not entirely: GitHub reads like discussion listings are GraphQL `POST`s, so the proxy would parse documents to refuse mutations.
- GraphQL reads are `POST`s, which CDNs don't cache; they'd rely on the upstream cache alone.
- Cache tags come from URL paths per forge (`/repos/:owner/:name/...` on GitHub) rather than refs in arguments and results.
- A verb that makes several upstream requests is several browser round trips instead of one call, each through the CDN.
- Argument validation, the OpenAPI document and `/docs` go away.
- Responses are each forge's raw payloads, so the CDN stores more and browsers download more than the normalised models.

**Open questions.** How much of npmx's traffic is GraphQL. Whether per-forge read rules are small enough to keep correct. Whether both could coexist: pass-through for `forges` clients, RPC for everyone else.

### No version prefix

Routes sit at the root (`/:forge/:instance/:verb`), not under `/v1`. The API mirrors the `forges` provider surface, so it changes when `forges` does and a path prefix couldn't stay stable on its own; releases carry the version instead. Auth guards everything but `/docs`, `/openapi.json` and webhooks, so a new route is private by default.

### HTTP caching first

Caching is expressed as response headers so the platform CDN does the work; the origin never stores responses itself. Nitro's `defineCachedHandler` was rejected because it stores at the origin, and the Netlify preset's `isr` route rule because it overwrites handler-set headers and applies to error responses too.

### No registry-level fan-out route (`/_all/...`)

**Context.** The `Forges` registry has methods that span providers: `search.threads`, `search.repos` and `notifications.list` merge every provider's results by date, and `threads.getMany` splits refs by provider. The rest of the registry routes by ref, which the per-provider routes already cover.

**Decision.** No server-side route for them. Clients get fan-out by registering the remote providers: `createForges(await connect(...))`.

**Why.**

- The merged listings exist only as iterables. Paging them over HTTP needs a composite cursor: every provider's cursor and how far into its buffered page the merge got. Stateless is possible, but it's new code to get right.
- A merged page depends on every provider, so it carries all their tags and is purged by a change in any of them. Per-provider pages cache on their own and are shared with plain reads.
- Client-side fan-out is `forges` itself, so its behaviour can't drift.

**Costs.** One request per provider per page instead of one, which matters to a browser on a slow connection. Non-TypeScript clients (curl, other languages, anything generated from the OpenAPI document) get no fan-out.

**Revisit if** npmx needs fewer browser round trips, or a non-TypeScript consumer needs cross-forge search. The shape would be `GET /_all/search.threads?args=...` with a base64 JSON cursor of per-provider cursors and offsets, and `POST /_all/threads.getMany`.

### Shared upstream store through the Cache API

On Netlify the upstream cache lives in the platform's Cache API: shared by every instance in a region, cleared on redeploy, and purgeable by tag globally. Elsewhere it is an in-memory LRU. Entries are written only once the verb has returned, so they carry the tags of the repositories in its result, not just its arguments.

### Manifest generated from the `forges` types

`ts-json-schema-generator` can't evaluate `Parameters<>`, so the script finds each verb's signature with the TypeScript checker and hands the declared parameter and result type nodes straight to the generator's parser, in one program. Lib types the wire carries differently are parsed by a custom parser, matched by symbol rather than by name: `Uint8Array` is `{ $bytes }`, `ReadableStream` the binary response, `AbortSignal` nothing, and `ForgeListing<T>` the `Page<T>` a listing answers with. The published declarations are bundled without `export` keywords, so every named type is parsed as a definition; only the types `forges` exports become components, and the rest are inlined. Everything runs on TypeScript 6 (`typescript-6`, and the generator's own `typescript` overridden to it in `pnpm-workspace.yaml`), the version `forges` is written in, since the root TypeScript 7 has no compiler API. A test fails while the checked-in manifest is stale. Candidate for upstreaming next to `forges`' `schemas.json`.
