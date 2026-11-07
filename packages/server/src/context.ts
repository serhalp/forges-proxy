import type { Forges } from "forges"

export type Env = Record<string, string | undefined>

/** Purges CDN entries by cache tag. */
export type Purge = (tags: string[]) => Promise<void>

/** The headers that hand a cacheable read to the CDN, given its CDN `cache-control` directives and cache tags. */
export type CdnHeaders = (read: { cacheControl: string; tags: string[] }) => Record<string, string>

/** The server's resolved options, as routes see them. */
export interface Context {
  /** Read on every request, so a changed variable applies without a new server. */
  env: Env
  forges: () => Forges
  /** Makes the providers revalidate every upstream response they hold. */
  expireUpstream: () => void
  purge?: Purge
  cdnHeaders: CdnHeaders
}
