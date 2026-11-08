import type { FetchLike, Forges } from "forges"
import { H3, handleCors } from "h3"
import { auth } from "#src/auth.ts"
import { proxyError } from "#src/errors.ts"
import type { CdnHeaders, Env, Purge } from "#src/context.ts"
import { providers } from "#src/providers.ts"
import { standardCdnHeaders } from "#src/response.ts"
import { docsRoute } from "#src/routes/docs.ts"
import { indexRoute } from "#src/routes/index.ts"
import { openapiRoute } from "#src/routes/openapi.ts"
import { statusRoute } from "#src/routes/status.ts"
import { verbRoute } from "#src/routes/verb.ts"
import { webhookRoute } from "#src/routes/webhook.ts"

export type { CdnHeaders, Env, Purge } from "#src/context.ts"
export { standardCdnHeaders } from "#src/response.ts"

export interface ServerOptions {
  /**
   * `FORGES_*` and `FORGES_PROXY_*` variables. `FORGES_PROXY_*` are read on every request; providers are built from
   * the rest on the first. @default process.env
   */
  env?: Env
  /**
   * Also serve, anonymously, every forge `env` doesn't mention that can be read without credentials at its default
   * instance. For public instances. @default false
   */
  anonymousForges?: boolean
  /** Providers to serve instead of those `env` configures. */
  forges?: Forges
  /** The `fetch` behind the providers, e.g. one that caches upstream responses. @default fetch */
  upstream?: FetchLike
  /** Purges CDN entries by tag when a webhook says they changed. Without it they expire by age. */
  purge?: Purge
  /** The headers that hand a cacheable read to the CDN. @default standardCdnHeaders: `CDN-Cache-Control`, `Cache-Tag` */
  cdnHeaders?: CdnHeaders
}

/** A [Fetchable](https://fetchable.org). */
export interface Server {
  fetch: (request: Request) => Promise<Response>
}

// Any origin: the secret is a header, never a cookie, so no request carries credentials the page didn't add itself.
const CORS = { origin: "*", methods: ["GET", "POST"], maxAge: "86400" } as const

/** The proxy, answering at its own root. */
export function createServer(options: ServerOptions = {}): Server {
  const env = options.env ?? globalThis.process?.env ?? {}
  const upstream = options.upstream ?? withUserAgent
  let forges = options.forges
  const context = {
    env,
    forges: () =>
      (forges ??= providers(env, { fetch: upstream, anonymous: options.anonymousForges ?? false })),
    purge: options.purge,
    cdnHeaders: options.cdnHeaders ?? standardCdnHeaders,
  }
  // h3's own errors (a misconfigured mode, a body that isn't JSON) in the proxy's error shape, never cached.
  const app = new H3({ onError: (error) => proxyError(error.status, error.message) })
    // Before auth, so preflights pass and errors stay readable.
    .use((event) => handleCors(event, { ...CORS, methods: [...CORS.methods] }) || undefined)
    .use(auth(context))
    .get("/", indexRoute(context))
    .get("/status", statusRoute(context))
    .get("/docs", docsRoute)
    .get("/openapi.json", openapiRoute(context))
    .post("/webhooks/:forge/:instance", webhookRoute(context))
    .all("/:forge/:instance/:verb", verbRoute(context))
  return { fetch: async (request) => app.fetch(request) }
}

/**
 * `forges` 0.3.2 takes Workers for a browser and sends no `user-agent`, which GitHub refuses; drop this once the fix is
 * released. Calls `fetch` through a closure, since some runtimes reject one detached from `globalThis`.
 */
const withUserAgent: typeof fetch = (input, init) => {
  const headers = new Headers(init?.headers)
  if (!headers.has("user-agent")) {
    headers.set("user-agent", "forges-proxy")
  }
  return fetch(input, { ...init, headers })
}

let server: Server | undefined

/** The proxy configured from `process.env`, created on its first request. */
export default {
  fetch: (request: Request) => (server ??= createServer()).fetch(request),
} satisfies Server
