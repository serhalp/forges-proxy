# forges-proxy plan

Self-hostable, single-tenant HTTP service on top of `forges`. Experimental; may move into the forges monorepo later.

Settled design and decision records are in [ARCHITECTURE.md](ARCHITECTURE.md); this file tracks what's next.

## Open questions

- What else to build on the manifest: Hey API client generation, an MCP server (read verbs as tools), argument validation.
- Whether the manifest and `connect()` move into `forges` (e.g. `forges/remote`), where the types live.

## TODO

- [x] Pin deps; link local `forges`
- [x] Generic dispatcher: providers from env, GET reads / POST writes, error mapping
- [x] Cache headers per verb class (public reads only; private is `no-store` until the parked issue is solved)
- [x] Proxy access secret (`FORGES_PROXY_SECRET`) or public mode (`FORGES_PROXY_PUBLIC=1`); both or neither is a 503
- [x] `GET /v1`: providers, capabilities, routed verbs
- [x] Tests: `node:test` (Node 26) with `forges/fake` behind `mock.module`; unit + route tests
- [x] `GET /v1/status` with `rateLimits()` (per server instance)
- [x] Pass the request signal through to verbs, into the options parameter the manifest names
- [ ] SSE for `sources.subscribe`
- [x] Upstream ETag fetch cache (`server/utils/upstream-cache.ts`), in-memory LRU store
- [x] Shared store for the upstream cache: the Cache API where the platform has one (Netlify), shared per region and tagged like the response; memory elsewhere. `x-upstream-cache` reports what it did per request.
- [x] Cache tags (`Netlify-Cache-Tag`) on public reads; `POST /webhooks/:forge/:instance` purges them on Netlify and expires the upstream cache. No Cloudflare-specific code (purge API, `Cache-Tag`) in this codebase.
- [x] Weak `ETag` on public JSON reads, with a 304 for a matching `If-None-Match` (verified live: Netlify's edge answers revalidations with it)
- [x] Stale-if-error upstream: a stored response stands in (up to a day past fresh) on 5xx, 429, a rate-limit 403 or a network error, not when the caller aborted
- [ ] Finer tags (per thread, per release) so an active repo doesn't purge all of its entries on every event
- [x] Operations manifest (`scripts/generate-manifest.ts` → `server/manifest.json`) → OpenAPI 3.1 (`/openapi.json`) → Scalar (`/docs`)
- [x] Validate `args` against the manifest's schemas (`@cfworker/json-schema`, no codegen, so fine at the edge): a 400 naming the failing path, e.g. `args/0/owner: Instance type "number" is invalid`
- [x] A test checks every `date-time` input field in the manifest is one `wire.ts` revives, so a new one in `forges` can't arrive as a string
- [x] Client: find options where the manifest puts them (via `/v1`), not by a heuristic
- [x] `connect()` client (`client/remote.ts`): one `ForgeProvider` per proxied forge
- [ ] Package the client (here or as `forges/remote`); report `rateLimits()` and `refreshCapabilities()` through the proxy

## Parked

- Private-data leak via edge cache (CDN answers before auth runs). Likely fix: `Netlify-Vary: header=authorization` (or the platform equivalent) on private instances.

## Notes for `forges`

- `DATE_FIELDS` / `reviveDates` cover output models only. Input options have `since`, `until`, `createdAfter`, `before`; the proxy revives those itself (`server/utils/wire.ts`).
- Error messages embed the upstream URL (e.g. `NotFoundError`), so leaving out `error.url` doesn't keep it private.
- Wire format today: positional `args` (a JSON array, `null` for a skipped optional argument), bytes as `{ "$bytes": "<base64>" }` both ways, `raw` dropped unless `?raw=1`, `undefined` results as 204. Bytes are tagged rather than a bare base64 string because `FileChange.content` takes text or bytes; before, bytes written through the client arrived as an index-keyed object.
- Upstream cache, verified live: GitHub answers revalidation with a real 304, but an _anonymous_ 304 still costs a request (53 → 52). GitHub documents 304s as free only for authenticated requests, so the public instance should run with a public-read token, not anonymous.
- Errors now cross the wire with every field their class sets (except `url` and `body`), and the client rebuilds the class with `Reflect.construct` instead of per-class constructors.
- Dropped the generated `isr` route rules: the handler already sets `Netlify-CDN-Cache-Control` per response and never on errors, which the preset's `isr` handling can't do (it overwrites and applies to every status).
- Tags are per repository, by both `repoKey` forms (path and `externalId`), since request refs usually lack the id that webhook refs carry and `repoKey` prefers it. Worth considering in `forges`: a helper that returns every key of a ref, for caches to index by.
- A webhook expires the whole upstream cache (not just the affected repos, whose entries are keyed by request hash), so a CDN refill can't come from an upstream copy the proxy still holds as fresh. Revalidations are 304s, so it's cheap.
- Upstream entries in the Cache API carry the proxy response's tags (writes wait until the verb returns, so tags include repos in the result), so a webhook purge deletes them in every region along with the CDN copy. Verified live on Netlify: after a purge the next read fetched; 20 concurrent reads across instances were all fresh. A purge deletes rather than marks stale, so the next read is a full request rather than a 304. Netlify allows 20 cache writes per invocation; a verb that fans out further stores only the first 20. `expire()` and the per-credential write timestamps are still per instance.
- Manifest: `ts-json-schema-generator` can't evaluate `Parameters<>`/`ReturnType<>`, so the script reads each verb's signature with the TypeScript checker (TS 6 as `typescript-6`, matching `forges`; the root TS 7 has no compiler API) and passes the declared type nodes to the generator's parser, with a custom parser for the lib types. Overloads (`releases.downloadAsset`) become unions. `ReadableStream<Uint8Array>` becomes a binary response, `Uint8Array` a `{ $bytes }` object, and `signal` is dropped. `Page<T>` components are renamed `PageOfT` (OpenAPI names allow no `<>`). Every verb has exactly one parameter carrying `signal`, which is how the manifest marks options. Worth upstreaming: `forges` could publish this next to `schemas.json`.
- OpenAPI is built at runtime, since it depends on the access mode (public leaves out writes and account verbs and enumerates the configured forges and instances). Scalar doesn't render `prefixItems`, so `args` also carries the signature as text (`[ref, options?]`). Valid per `redocly lint --extends=spec`.
- Nitro Netlify preset gaps, candidates to upstream: the `isr` rule sets the CDN header on every status including errors, overwrites a handler-set `Netlify-CDN-Cache-Control`, and has a fixed one-year SWR window.
