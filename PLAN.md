# forges-proxy plan

Open work and future ideas. Settled design decisions live in [ARCHITECTURE.md](ARCHITECTURE.md).
This project is experimental and may eventually move into the `forges` monorepo.

## Open questions

- **Dynamic forge hosts** (Tangled user servers and knots, self-hosted instances, Radicle nodes):
  Today the proxy only serves instances explicitly configured in the environment. How should it
  support dynamic hosts while preventing SSRF against internal networks from user-supplied hosts?
- **Manifest consumers**: What else should build on the operations manifest (e.g. Hey API client
  generation, an MCP server)?
- **Upstreaming into `forges`**: Should `discoverProviders()` move into `forges` (e.g.
  `forges/remote`), or should the whole project become `@forges/server` and `@forges/client`? Check
  with the `forges` maintainers.

## TODO

- [x] Pin dependencies
- [x] Generic dispatcher: providers from env, GET reads / POST writes, error mapping
- [x] Cache headers per verb class (public reads only; private responses use `no-store` until
      auth-varied caching is solved)
- [x] Proxy access secret (`FORGES_PROXY_SECRET`) or public mode (`FORGES_PROXY_PUBLIC=1`); return
      503 if both or neither are set
- [x] Secret rotation: accept `FORGES_PROXY_PREVIOUS_SECRET` alongside `FORGES_PROXY_SECRET`
- [x] Include `sources.stream` in `/openapi.json`
- [x] `GET /_meta`: providers, capabilities, and routed verbs
- [x] Tests: `node:test` with `forges/fake` passed to `createServer`; unit and route tests
- [x] `GET /_status` reporting per-instance `rateLimits()`
- [x] SSE route for `sources.stream` (verified live against Tangled's Jetstream). Note: `forges`
      `main` renames this to `sources.subscribe`; update on the next `forges` bump.
- [x] Forward the request `AbortSignal` into the verb's options parameter
- [x] Cache tags on public reads; `POST /webhooks/:forge/:instance` purges affected tags via `purge`
- [x] `handleEvents`: pass verified webhook events to a deployment callback and await it
- [x] `logger` option: log requests at `info` and internal failures at `error` (defaults to errors
      only via `console.error`); use evlog in the platform and Docker demos
- [x] Weak `ETag` on public JSON reads with `304 Not Modified` on `If-None-Match` (verified live on
      Netlify Edge)
- [x] CORS: allow `*` origin (auth uses `Authorization` header, never cookies), cache preflights for
      24h
- [ ] Evaluate [`cdn-cache-control`](https://github.com/ascorbic/cdn-cache-control) for
      `cdnHeaders`. Gotchas: `.swr()` resets the TTL (call `.ttl()` after), and it only emits the
      vendor-specific header rather than both `CDN-Cache-Control` and the vendor header.
- [ ] Finer-grained cache tags (per thread, per release) so busy repos don't invalidate all cached
      reads on every webhook event
- [x] Operations manifest from `forges/schema` → OpenAPI 3.1 (`/openapi.json`) → Scalar (`/_docs`)
- [x] Validate `args` against manifest schemas (`@cfworker/json-schema`, which avoids `eval`/codegen
      for edge runtimes) and return 400 with the failing field path
- [x] Test that every `date-time` input field in the manifest is decoded by `forges/wire`
- [x] Client: use the options parameter index reported by `GET /_meta` instead of a heuristic
- [x] `discoverProviders()` client (`@forges-proxy/client`): returns one `ForgeProvider` per proxied
      forge
- [x] pnpm workspace: `@forges-proxy/server`, `@forges-proxy/client`, `docs` placeholder, and
      `demos/netlify-serverless`
- [x] Replace Nitro with plain h3 + tsdown: `createServer(options)` returns a Fetchable and takes
      platform hooks (`cdnHeaders`, `purge`, `fetch`) as options
- [x] Demos smoke-tested via `pnpm smoke`: node, hono, fastify, nitro, docker, cloudflare-workers,
      vercel, netlify-serverless
- [x] `demos/netlify-edge`: verify Fetchable export live. Note: Netlify's edge bundler resolves npm
      modules from the monorepo root where pnpm doesn't hoist workspace packages, so the root
      `package.json` includes `@forges-proxy/server` and `evlog` in `devDependencies`.
- [x] `demos/netlify-server` (Early Access): smoke-tested live. Configured with a package directory
      rather than a base directory to work around a path-doubling bug in `@netlify/build` (see
      `NETLIFY_SERVER_MONOREPO_BUG.md`).
- [x] HMAC-signed cursors on public instances with authenticated providers so caller-supplied
      `nextUrl` values cannot hit arbitrary upstream API paths
- [ ] Package publishing and release tooling (`@forges-proxy` npm scope is registered)
- [ ] Configurable per-caller and per-route rate limiting (already shown in the server diagram).
      Reopens
      [Rate limiting is the platform's job](ARCHITECTURE.md#rate-limiting-is-the-platforms-job),
      likely via a `rateLimit` hook backed by the platform's rate limiter or KV store.
- [x] Client: populate `rateLimits()` from the `forges-rate-limits` response header and support
      `refreshCapabilities()` against `GET /_meta`

## Parked

- **A testing helper for proxy consumers**: npmx had to hand-write the proxy's description and verb
  responses in three places to mock it. A `@forges-proxy/client/testing` entry could export
  `mockProxy(forges)`, a `fetch` that runs the real server in-process over the given providers (e.g.
  `forges/fake`), as the client's own tests do. That makes the server an optional peer of that
  entry.
- **Cache purging and `handleEvents` for stream-based forges (Tangled)**: `sources.stream` currently
  only proxies a stream to a connected client, so cached Tangled reads only expire by TTL. A
  long-running server (Docker, Node, Netlify Server) could maintain a background subscription from a
  persisted cursor and feed events into the webhook purge/handler pipeline.
- **Short CDN TTL (e.g. 5s) on public 404s**: Prevents repeated requests for missing repositories
  from burning upstream rate limits.
- **MCP server package**: Expose read verbs as MCP tools in a new workspace package.
- **Cache tag cap counting (`MAX_REPO_TAGS` in `tags.ts`)**: Currently counts tag strings rather
  than repositories. Because repos with an `externalId` emit two tags (path and ID), pages with 26+
  repos exceed the 50-tag cap and fall back to the instance tag alone, which webhooks never purge.
  Count repos instead, align the limit with CDN header limits, and either drop or support purging
  the instance tag.
- **Timeout on `provider.refreshCapabilities()` in `GET /_meta`**: An unreachable self-hosted forge
  currently blocks `GET /_meta` (and therefore `discoverProviders()`) for up to `forges`'s 30s
  request timeout on each cold server instance. Add a short timeout and fall back to static
  capabilities.
- **CDN caching on private instances**: Currently disabled (`private, no-store`) because the CDN
  serves cached responses before auth middleware runs. Could be enabled on CDNs that support varying
  on `Authorization` (e.g. `Netlify-Vary: header=authorization`).
- **Multi-caller auth and per-caller credentials**: Supporting multiple callers beyond a single
  shared secret or anonymous public mode involves two questions: authenticating the caller, and
  selecting which upstream forge credential to use.
  - Non-JS services can pass their own forge token or use scoped proxy API keys.
  - Internal tools, bots, and CI jobs want proxy-held credentials gated by scoped proxy keys or CI
    OIDC tokens.
  - Sandboxes need short-lived, scoped proxy tokens without direct forge tokens.
  - End-user apps and agents need to act on behalf of a user via OAuth (managed by either the proxy
    or the caller).
  - Hard invariants: never share cached responses across identities, never fall back to the
    operator's token on auth failure, and never log tokens.

## Notes

- Cloudflare Workers define `WorkerGlobalScope`, which causes `forges` (as of 0.4.1) to treat the
  runtime as a browser and omit the `User-Agent` header. GitHub rejects requests without
  `User-Agent` with a 403 (`InsufficientScopeError`). Until fixed upstream, the server's default
  `fetch` injects `User-Agent: forges-proxy` (`withUserAgent` in `packages/server/src/index.ts`).
- `forges/wire` handles tagged `$date` and `$bytes` values in both directions.
- `ForgeError` messages often include the upstream URL (e.g. in `NotFoundError`), so stripping
  `error.url` from the error response does not completely hide upstream URLs.
- Errors are serialized with all subclass properties except `url`, `body`, and `grantedScopes`; the
  client reconstructs the instance using `Reflect.construct`.
- Responses are tagged with both forms of `repoKey` (`owner/name` and `@externalId`) because call
  arguments usually only have `owner/name` while webhook payloads include `externalId` (which
  `repoKey()` prefers).
- `/openapi.json` is generated at runtime based on the access mode: public instances omit write,
  account, and privileged verbs and populate `enum` lists for configured forges and instances.
  Because Scalar does not render tuple `prefixItems`, the `args` parameter description also includes
  the positional signature as text (e.g. `` `[ref, options?]` ``). Validates cleanly with
  `redocly lint --extends=spec`.
