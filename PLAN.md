# forges-proxy plan

What's next. Settled design and decisions are in [ARCHITECTURE.md](ARCHITECTURE.md). Experimental; may move into the `forges` monorepo.

## Open questions

- RPC or a transparent forge-API proxy? See [ARCHITECTURE.md](ARCHITECTURE.md#under-consideration-a-transparent-forge-api-proxy-instead-of-rpc).
- Forges whose hosts aren't known in advance (Tangled authors' servers and knots, self-hosted instances, Radicle nodes). The proxy only serves instances configured in the env. How should it serve the rest, and what stops hosts named by user data from reaching the proxy's own network?
- What else to build on the manifest? Hey API client generation, an MCP server.
- Should the manifest and `connect()` move into `forges` (e.g. `forges/remote`), where the types live? Or the whole project, as `@forges/server` and `@forges/client`? Ask the `forges` team.

## TODO

- [x] Pin deps
- [x] Generic dispatcher: providers from env, GET reads / POST writes, error mapping
- [x] Cache headers per verb class (public reads only; private is `no-store` until the parked issue is solved)
- [x] Proxy access secret (`FORGES_PROXY_SECRET`) or public mode (`FORGES_PROXY_PUBLIC=1`); both or neither is a 503
- [x] `GET /`: providers, capabilities, routed verbs
- [x] Tests: `node:test` (Node 26) with `forges/fake` passed to `createServer`; unit and route tests
- [x] `GET /status` with `rateLimits()` (per server instance)
- [x] Pass the request signal through to verbs, into the options parameter the manifest names
- [ ] SSE for `sources.stream`
- [x] Upstream ETag fetch cache (`packages/server/src/upstream-cache.ts`), in-memory LRU store
- [x] Shared upstream store on the Cache API (`cacheApiStore`), per region and tagged like the response. `x-upstream-cache` reports what it did per request.
- [x] Cache tags on public reads; `POST /webhooks/:forge/:instance` purges them through the `purge` option and expires the upstream cache
- [x] Weak `ETag` on public JSON reads, with a 304 for a matching `If-None-Match` (verified live: Netlify's edge answers revalidations with it)
- [x] Stale-if-error upstream: a stored response stands in (up to a day past fresh) on 5xx, 429, a rate-limit 403 or a network error, not when the caller aborted
- [x] CORS: any origin (the secret is a header, never a cookie), preflights cached for a day
- [ ] Evaluate [`cdn-cache-control`](https://github.com/ascorbic/cdn-cache-control) for `cdnHeaders` (per-CDN header names). Gotchas: `.swr()` resets the TTL (call `.ttl()` after), and it sends only the CDN-specific header, not `CDN-Cache-Control` too.
- [ ] Finer tags (per thread, per release) so an active repo doesn't purge all of its entries on every event
- [x] Operations manifest (`packages/server/scripts/generate-manifest.ts` → `packages/server/src/manifest.json`) → OpenAPI 3.1 (`/openapi.json`) → Scalar (`/docs`)
- [x] Validate `args` against the manifest's schemas (`@cfworker/json-schema`: no codegen, so fine at the edge), with a 400 naming the failing path
- [x] A test checks every `date-time` input field in the manifest is one `wire.ts` revives, so a new one in `forges` can't arrive as a string
- [x] Client: find options where the manifest puts them (via `/`), not by a heuristic
- [x] `connect()` client (`@forges-proxy/client`): one `ForgeProvider` per proxied forge
- [x] pnpm workspace: `@forges-proxy/server` (a Fetchable), `@forges-proxy/client`, `docs` placeholder, `demos/netlify-serverless` (verified live as a draft)
- [x] Drop Nitro: `createServer(options)` on h3 returns a Fetchable; platform specifics (`cdnHeaders`, `purge`, `upstreamStore`) are options, so purging is pluggable. Built with tsdown.
- [x] Demos, smoke-tested with `pnpm smoke` through the client: node, hono, fastify, nitro, docker (local, public and private), cloudflare-workers (`wrangler dev`), vercel (live), netlify-serverless (live draft)
- [ ] netlify-edge: runs under `netlify serve`, but deployed drafts never invoke it. Neither does a hello-world edge function on the same site, so it's the site or the deploy path. (The edge bundler resolves npm modules from the repository root, where pnpm doesn't link workspace packages, hence the root `package.json`'s dependency on `@forges-proxy/server`.)
- [ ] cloudflare-workers: deploy
- [ ] Publish the packages: release tooling (npm scope `@forges-proxy` is registered)
- [ ] Client: report `rateLimits()` and `refreshCapabilities()` through the proxy

## Parked

- Secret rotation without downtime: accept a second secret alongside `FORGES_PROXY_SECRET` while callers move over. Important.
- A very short CDN TTL (e.g. 5s) on public 404s, so floods of missing repos don't all reach the forge.
- An MCP server (read verbs as tools), as a workspace package.
- CDN caching for private instances, which send `no-store` because the CDN answers before auth runs. Likely fix: vary on `authorization` (`Netlify-Vary: header=authorization` or the platform's equivalent).
- Multiple callers with different identities, beyond one all-access secret or anonymous public mode. Two separate questions: who is calling, and whose forge credential is used.
  - Per use case: non-JS clients can hold secrets (pass their forge token through, or per-caller proxy keys). Internal tools, bots and CI want proxy-held credentials with scoped keys per caller, or CI's OIDC token mapped to a policy. Sandboxes want a short-lived scoped proxy token, never a forge token. npmx-style services and agents need to act as the end user (OAuth, run by the proxy or the caller; MCP's auth spec uses OAuth).
  - Most cases generalise private mode from one secret to many scoped identities; acting as the end user is the harder, stateful part (token storage, refresh, sessions).
  - Whatever the shape: no shared cache across identities, never fall back to the operator's credential, no tokens in logs.

## Notes

- Cloudflare Workers define `WorkerGlobalScope`, so `forges` 0.3.2 takes them for a browser and sends no `user-agent`; GitHub answers 403, which surfaces as `InsufficientScopeError`. Fixed on `forges` main; until it's released, the server's default upstream `fetch` adds one (`withUserAgent` in `packages/server/src/index.ts`). Drop that after the next `forges` release.
- `DATE_FIELDS` / `reviveDates` cover output models only. Input options have `since`, `until`, `createdAfter`, `before`; the proxy revives those itself (`packages/server/src/wire.ts`).
- Error messages embed the upstream URL (e.g. `NotFoundError`), so leaving out `error.url` doesn't keep it private.
- Upstream cache, verified live: GitHub answers revalidation with a real 304, but an _anonymous_ 304 still costs a request (53 → 52). GitHub documents 304s as free only for authenticated requests, so the public instance should run with a public-read token, not anonymous.
- Errors cross the wire with every field their class sets except `url` and `body`; the client rebuilds the class with `Reflect.construct`.
- Tags are per repository, by both `repoKey` forms (path and `externalId`), since request refs usually lack the id that webhook refs carry and `repoKey` prefers it. Worth considering in `forges`: a helper that returns every key of a ref, for caches to index by.
- A webhook expires the whole upstream cache (not just the affected repos, whose entries are keyed by request hash), so a CDN refill can't come from an upstream copy the proxy still holds as fresh. Revalidations are 304s, so it's cheap.
- Verified live on Netlify: after a purge, the next read fetched, and 20 concurrent reads across instances were all fresh. A purge deletes Cache API entries rather than marking them stale, so the next read is a full request, not a 304. Netlify allows 20 cache writes per invocation, so a verb that fans out further stores only the first 20. `expire()` and the per-credential write timestamps are per instance.
- Manifest details beyond ARCHITECTURE.md: overloads (`releases.downloadAsset`) become unions, `Page<T>` components are renamed `PageOfT` (OpenAPI names allow no `<>`), and every verb has exactly one parameter carrying `signal`, which is how the manifest marks options.
- OpenAPI is built at runtime, since it depends on the access mode (public leaves out writes and account verbs and enumerates the configured forges and instances). Scalar doesn't render `prefixItems`, so `args` also carries the signature as text (`[ref, options?]`). Valid per `redocly lint --extends=spec`.
