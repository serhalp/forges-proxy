# forges-proxy plan

Self-hostable, single-tenant HTTP service on top of `forges`. Experimental; may move into the forges monorepo later.

## Decisions

- **Single tenant.** Forge credentials come only from the proxy's env, via `providersFromEnv` (`forges/env`). Callers never pass forge tokens.
- **Proxy access secret** in env for private instances (bearer). A public instance (official deployment) runs public-read tokens with `FORGES_*_READ_ONLY` and doesn't route write verbs.
- **RPC, not REST.** Verbs map 1:1 to the `ForgeProvider` surface:
  - `GET  /v1/:forge/:instance/:verb?input=<json>` for reads (cacheable)
  - `POST /v1/:forge/:instance/:verb` for writes
  - No registry-level fan-out route: `createForges(await connect(...))` fans out on the client, over per-provider pages that each cache on their own. A server-side merged search would need composite cursors and would cache worse.
  - Verb classification (write / account / listing) comes from `CAPABILITY_TABLE`.
  - Expose only `*Page` listings over HTTP; clients rebuild iterables with `iteratePages`.
  - Streams (`ci.log`, `releases.downloadAsset`) pass through; `sources.subscribe` goes over SSE.
  - Never expose `provider.request` (accepts absolute URLs, so SSRF) or `installations.provider(s)`.
- **Nitro v3**, intentionally, beta and all.
- **HTTP caching first.** Response caching is expressed as headers so the platform CDN does the work (Netlify: `Netlify-CDN-Cache-Control`, `durable`, `Netlify-Cache-Tag`, `Netlify-Vary`). Origin-side storage caching is only a fallback for platforms with no CDN.
  - Use `defineCachedHandler` with a `storage` chosen by deploy target: a no-op `{ get: () => null, set() {} }` on Netlify or behind Caddy/Varnish, memory or Redis on bare Node. Keeps request narrowing, ETag and coalescing from one code path.
  - Set the CDN-specific headers ourselves; Nitro leaves a handler-set `cache-control` alone.
  - Unverified: whether a 304 is sent for `If-None-Match` when nothing is stored.
  - Netlify preset already maps the `isr` route rule to `Netlify-CDN-Cache-Control: …, durable` (no origin storage). Generate `routeRules` per verb from `CAPABILITY_TABLE` in `nitro.config.ts`. Handler adds `Netlify-Cache-Tag` / `Netlify-Vary` and generic `CDN-Cache-Control`.
  - Preset gaps (candidates to upstream): sets the CDN header on every status incl. errors (check what Netlify actually stores), overwrites a handler-set `Netlify-CDN-Cache-Control`, fixed 1-year SWR window.
- **Upstream ETag revalidation** is a separate layer: a `fetch` wrapper passed to every provider. Fresh within upstream `max-age` → serve; stale with an ETag → `If-None-Match` → on 304, serve the stored body (on GitHub a 304 doesn't count against the rate limit). Pays off even when inbound and outbound are 1:1, because a CDN miss re-fetches cheaply; also catches fan-out (checks, emulated `getComment`, tree walks) and sharing between inbound variants.
  - Store: Cache API where native (Workers, Deno, Netlify); undici cache interceptor or Nitro storage on Node.
  - Gotchas: Cache API does no HTTP semantics itself; Cloudflare refuses `private` responses (rewrite headers before storing); key on provider identity, not just URL; GraphQL POSTs aren't cacheable; pass through requests that already carry conditional headers (forges' own `cursor.etag`); per location, not global.
- **Invalidation:** webhooks → `affectedKeys()` → purge cache tags.

## Open questions

- Operations manifest (verb → param names and schemas → return schema). Not needed for the dispatcher; needed for OpenAPI, validation, Hey API and MCP. `schemas.json` only covers output models: no input types, no `Page<T>`, no verb signatures. Plan: build-time TS compiler script in this repo, upstream later.
- Wire encoding: error round-trip (`ForgeError` name + context), `Uint8Array` in `FileContent`, stripping `raw` by default.
- `remote()` client provider implementing `ForgeProvider` over this protocol (for npmx).

## TODO

- [x] Pin deps; link local `forges`
- [x] Generic dispatcher: providers from env, GET reads / POST writes, error mapping
- [x] Cache headers per verb class (public reads only; private is `no-store` until the parked issue is solved)
- [x] Proxy access secret (`FORGES_PROXY_SECRET`) or public mode (`FORGES_PROXY_PUBLIC=1`); both or neither is a 503
- [x] `GET /v1`: providers, capabilities, routed verbs
- [x] Tests: `node:test` (Node 26) with `forges/fake` behind `mock.module`; unit + route tests
- [x] `GET /v1/status` with `rateLimits()` (per server instance)
- [ ] Pass the request signal through to verbs (needs to know which arg is `options`; manifest)
- [ ] SSE for `sources.subscribe`
- [x] Upstream ETag fetch cache (`server/utils/upstream-cache.ts`), in-memory LRU store
- [ ] Shared store for the upstream cache (Nitro storage or Cache API) so serverless instances share it
- [x] Cache tags (`Cache-Tag`, `Netlify-Cache-Tag`) on public reads; `POST /webhooks/:forge/:instance` purges them (Netlify or Cloudflare) and expires the upstream cache
- [ ] Finer tags (per thread, per release) so an active repo doesn't purge all of its entries on every event
- [ ] Operations manifest → OpenAPI → Scalar
- [x] `connect()` client (`client/remote.ts`): one `ForgeProvider` per proxied forge
- [ ] Package the client (here or as `forges/remote`); report `rateLimits()` and `refreshCapabilities()` through the proxy

## Parked

- Private-data leak via edge cache (CDN answers before auth runs). Likely fix: `Netlify-Vary: header=authorization` (or the platform equivalent) on private instances.

## Notes for `forges`

- `DATE_FIELDS` / `reviveDates` cover output models only. Input options have `since`, `until`, `createdAfter`, `before`; the proxy revives those itself (`server/utils/wire.ts`).
- Error messages embed the upstream URL (e.g. `NotFoundError`), so leaving out `error.url` doesn't keep it private.
- Wire format today: positional `args` (a JSON array), `Uint8Array` as base64 with `encoding: 'binary'` left as is, `raw` dropped unless `?raw=1`, `undefined` results as 204.
- Upstream cache, verified live: GitHub answers revalidation with a real 304, but an _anonymous_ 304 still costs a request (53 → 52). GitHub documents 304s as free only for authenticated requests, so the public instance should run with a public-read token, not anonymous.
- Client: iterables split their arguments with a heuristic (a trailing object without `forge` is the options), since refs always name their forge. The operations manifest would replace it.
- Errors now cross the wire with every field their class sets (except `url` and `body`), and the client rebuilds the class with `Reflect.construct` instead of per-class constructors.
- Dropped the generated `isr` route rules: the handler already sets `Netlify-CDN-Cache-Control` per response and never on errors, which the preset's `isr` handling can't do (it overwrites and applies to every status).
- Tags are per repository, by both `repoKey` forms (path and `externalId`), since request refs usually lack the id that webhook refs carry and `repoKey` prefers it. Worth considering in `forges`: a helper that returns every key of a ref, for caches to index by.
- A webhook expires the whole upstream cache (not just the affected repos, whose entries are keyed by request hash), so a CDN refill can't come from an upstream copy the proxy still holds as fresh. Revalidations are 304s, so it's cheap.
