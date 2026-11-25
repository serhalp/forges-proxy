import type { FetchLike, Forges } from "forges"
import type { H3Event } from "h3"
import { H3, handleCors } from "h3"
import { auth } from "./auth.ts"
import { cursorKey as signingKey } from "./cursors.ts"
import { proxyError } from "./errors.ts"
import type { CdnHeaders, Env, HandleEvents, Logger, Purge } from "./context.ts"
import { providers } from "./providers.ts"
import { standardCdnHeaders } from "./response.ts"
import { docsRoute } from "./routes/docs.ts"
import { landingRoute } from "./routes/landing.ts"
import { llmsRoute } from "./routes/llms.ts"
import { metaRoute } from "./routes/meta.ts"
import { openapiRoute } from "./routes/openapi.ts"
import { statusRoute } from "./routes/status.ts"
import { streamRoute } from "./routes/stream.ts"
import { verbRoute } from "./routes/verb.ts"
import { webhookRoute } from "./routes/webhook.ts"

export type { CdnHeaders, Env, HandleEvents, Logger, Purge } from "./context.ts"
export { standardCdnHeaders } from "./response.ts"

export interface ServerOptions {
  /**
   * `FORGES_*` and `FORGES_PROXY_*` environment variables. `FORGES_PROXY_*` are read per request;
   * providers are initialized once on the first request. @default process.env
   */
  env?: Env
  /**
   * Enable anonymous reads for any unconfigured forge that supports unauthenticated access at its
   * default instance. Intended for public instances. @default false
   */
  anonymousForges?: boolean
  /** Custom `Forges` registry to serve instead of building providers from `env`. */
  forges?: Forges
  /** Custom `fetch` implementation passed to providers (e.g. for upstream caching). @default fetch */
  fetch?: FetchLike
  /** Purges CDN cache entries by tag when a webhook delivery reports changes. */
  purge?: Purge
  /** Invoked with verified webhook events after purging cache tags. Awaited before responding. */
  handleEvents?: HandleEvents
  /** Formats CDN cache headers for cacheable public read responses. @default standardCdnHeaders */
  cdnHeaders?: CdnHeaders
  /**
   * Structured logger for request (`info`) and internal error (`error`) events. Pass the logger
   * object itself rather than unbound methods. @default errors to `console.error`, no request logs
   */
  logger?: Logger
}

/** A standard [Fetchable](https://fetchable.org) (`{ fetch(request) }`). */
export interface Server {
  fetch: (request: Request) => Promise<Response>
}

// Auth uses the `Authorization` header (never cookies), so `*` cannot carry ambient browser credentials.
const CORS = { origin: "*", methods: ["GET", "POST"], maxAge: "86400" } as const

// Hosting platforms already log incoming requests, so only emit per-request logs when the caller passes a logger.
const errorsOnly: Logger = { error: (event) => console.error(event) }

/** Creates a `forges-proxy` server rooted at `/`. */
export function createServer(options: ServerOptions = {}): Server {
  const env = options.env ?? globalThis.process?.env ?? {}
  let forges = options.forges
  let cursorKey: Promise<CryptoKey> | undefined
  const logger = options.logger ?? errorsOnly
  const context = {
    env,
    forges: () =>
      (forges ??= providers(env, {
        fetch: options.fetch ?? withUserAgent,
        anonymous: options.anonymousForges ?? false,
        logger,
      })),
    cursorKey: () => (cursorKey ??= signingKey(env)),
    purge: options.purge,
    handleEvents: options.handleEvents,
    cdnHeaders: options.cdnHeaders ?? standardCdnHeaders,
    logger,
  }
  const started = new WeakMap<H3Event, number>()
  const app = new H3({
    // Suppress h3's default `console.error` so unhandled exceptions route only to `logger`.
    silent: true,
    onRequest: (event) => void started.set(event, performance.now()),
    onResponse: (response, event) =>
      logger.info?.({
        message: "request",
        method: event.req.method,
        path: event.url.pathname,
        status: response.status,
        durationMs: Math.round(performance.now() - (started.get(event) ?? performance.now())),
      }),
    // h3 errors bypass route middleware, so attach `Access-Control-Allow-Origin` explicitly for browser callers.
    onError: (error) => {
      const cors = { "access-control-allow-origin": CORS.origin }
      if (!error.unhandled) return proxyError(error.status, error.message, cors)
      logger.error({ message: "Unhandled error", error })
      return proxyError(500, "Internal error", cors)
    },
  })
    // Run CORS before auth so preflights succeed and 401 responses are readable by browsers.
    .use((event) => handleCors(event, { ...CORS, methods: [...CORS.methods] }) || undefined)
    .use(auth(context))
    .get("/", landingRoute(context))
    .get("/llms.txt", llmsRoute(context))
    .get("/_meta", metaRoute(context))
    .get("/_status", statusRoute(context))
    .get("/_docs", docsRoute)
    .get("/openapi.json", openapiRoute(context))
    .post("/webhooks/:forge/:instance", webhookRoute(context))
    .get("/:forge/:instance/sources.stream", streamRoute(context))
    .all("/:forge/:instance/:verb", verbRoute(context))
  return { fetch: async (request) => app.fetch(request) }
}

/**
 * Workaround for `forges` 0.4.1 omitting `User-Agent` on Cloudflare Workers (`WorkerGlobalScope`),
 * which causes GitHub to reject requests with 403. Wrap `fetch` in a closure so `globalThis` binding
 * is preserved across runtimes.
 */
const withUserAgent: typeof fetch = (input, init) => {
  const headers = new Headers(init?.headers)
  if (!headers.has("user-agent")) {
    headers.set("user-agent", "forges-proxy")
  }
  return fetch(input, { ...init, headers })
}

let server: Server | undefined

/** Default server instance configured from `process.env`, initialized lazily on the first request. */
const fromEnv: Server = {
  fetch: (request) => (server ??= createServer()).fetch(request),
}
export default fromEnv
