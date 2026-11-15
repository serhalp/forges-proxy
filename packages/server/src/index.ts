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
import { indexRoute } from "./routes/index.ts"
import { openapiRoute } from "./routes/openapi.ts"
import { statusRoute } from "./routes/status.ts"
import { streamRoute } from "./routes/stream.ts"
import { verbRoute } from "./routes/verb.ts"
import { webhookRoute } from "./routes/webhook.ts"

export type { CdnHeaders, Env, HandleEvents, Logger, Purge } from "./context.ts"
export { standardCdnHeaders } from "./response.ts"

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
  fetch?: FetchLike
  /** Purges CDN entries by tag when a webhook says they changed. Without it they expire by age. */
  purge?: Purge
  /** Called with each verified webhook delivery's events, after its purge. Awaited, so hand slow work to a queue. */
  handleEvents?: HandleEvents
  /** The headers that hand a cacheable read to the CDN. @default standardCdnHeaders: `CDN-Cache-Control`, `Cache-Tag` */
  cdnHeaders?: CdnHeaders
  /**
   * Where the server logs requests (`info`) and its own failures (`error`). Pass the logger itself, not its methods.
   * @default errors to `console.error`, no request logs
   */
  logger?: Logger
}

/** A [Fetchable](https://fetchable.org). */
export interface Server {
  fetch: (request: Request) => Promise<Response>
}

// Any origin: the secret is a header, never a cookie, so no request carries credentials the page didn't add itself.
const CORS = { origin: "*", methods: ["GET", "POST"], maxAge: "86400" } as const

// A platform logs requests itself, so only a logger the deployment chose gets one line per request.
const errorsOnly: Logger = { error: (event) => console.error(event) }

/** The proxy, answering at its own root. */
export function createServer(options: ServerOptions = {}): Server {
  const env = options.env ?? globalThis.process?.env ?? {}
  let forges = options.forges
  let cursorKey: Promise<CryptoKey> | undefined
  const context = {
    env,
    forges: () =>
      (forges ??= providers(env, {
        fetch: options.fetch ?? withUserAgent,
        anonymous: options.anonymousForges ?? false,
      })),
    cursorKey: () => (cursorKey ??= signingKey(env)),
    purge: options.purge,
    handleEvents: options.handleEvents,
    cdnHeaders: options.cdnHeaders ?? standardCdnHeaders,
    logger: options.logger ?? errorsOnly,
  }
  const { logger } = context
  const started = new WeakMap<H3Event, number>()
  const app = new H3({
    // Unhandled exceptions go to `logger` instead of h3's `console.error`.
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
    // h3's own errors (a misconfigured mode, a body that isn't JSON) in the proxy's error shape, never cached.
    onError: (error) => {
      if (!error.unhandled) return proxyError(error.status, error.message)
      // The message could carry anything, so it stays in the logs.
      logger.error({ message: "Unhandled error", error })
      return proxyError(500, "Internal error")
    },
  })
    // Before auth, so preflights pass and errors stay readable.
    .use((event) => handleCors(event, { ...CORS, methods: [...CORS.methods] }) || undefined)
    .use(auth(context))
    .get("/", indexRoute(context))
    .get("/status", statusRoute(context))
    .get("/docs", docsRoute)
    .get("/openapi.json", openapiRoute(context))
    .post("/webhooks/:forge/:instance", webhookRoute(context))
    .get("/:forge/:instance/sources.stream", streamRoute(context))
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
