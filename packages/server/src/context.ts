import type { ForgeEvent, Forges } from "forges"

export type Env = Record<string, string | undefined>

/** Purges CDN cache entries matching any of `tags`. */
export type Purge = (tags: string[]) => Promise<void>

/** Processes verified webhook events after cache purging. Throwing returns a 500 response. */
export type HandleEvents = (
  events: ForgeEvent[],
  source: { forge: string; instance: string },
) => void | Promise<void>

/**
 * Structured logger interface compatible with `console`, pino, and evlog's `log`.
 */
export interface Logger {
  info?(event: Record<string, unknown>): void
  error(event: Record<string, unknown>): void
}

/** Builds CDN cache headers from the computed `cache-control` value and repository cache tags. */
export type CdnHeaders = (read: { cacheControl: string; tags: string[] }) => Record<string, string>

export interface Context {
  /** `FORGES_PROXY_*` are read per request; providers are initialized once on first access. */
  env: Env
  forges: () => Forges
  cursorKey: () => Promise<CryptoKey>
  purge?: Purge
  handleEvents?: HandleEvents
  cdnHeaders: CdnHeaders
  logger: Logger
}
