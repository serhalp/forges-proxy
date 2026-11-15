import type { ForgeEvent, Forges } from "forges"

export type Env = Record<string, string | undefined>

/** Purges CDN entries by cache tag. */
export type Purge = (tags: string[]) => Promise<void>

/** Handles a verified webhook delivery's events. The response waits for it; a throw answers 500. */
export type HandleEvents = (
  events: ForgeEvent[],
  source: { forge: string; instance: string },
) => void | Promise<void>

/**
 * A logger that takes structured events: the server logs one `info` per request and its own failures as `error`.
 * `console`, pino, and evlog's `log` all fit, and their levels decide what's kept.
 */
export interface Logger {
  info?(event: Record<string, unknown>): void
  error(event: Record<string, unknown>): void
}

/** The headers that hand a cacheable read to the CDN, given its CDN `cache-control` directives and cache tags. */
export type CdnHeaders = (read: { cacheControl: string; tags: string[] }) => Record<string, string>

/** The server's resolved options, as routes see them. */
export interface Context {
  /** `FORGES_PROXY_*` are read on every request; providers are built from the rest once. */
  env: Env
  forges: () => Forges
  purge?: Purge
  handleEvents?: HandleEvents
  cdnHeaders: CdnHeaders
  logger: Logger
}
