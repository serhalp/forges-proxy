import type { AccessMode } from "./access.ts"
import type { VerbInfo } from "./verbs.ts"

const READ_MAX_AGE = 60
const READ_STALE = 600

/**
 * Cache headers for a successful response. Shared caches only see public reads; browsers always revalidate.
 * Private instances send `no-store` until CDN caching can be keyed on the proxy secret (see PLAN.md).
 */
export function cacheHeaders(
  verb: VerbInfo,
  mode: AccessMode,
  tags: string[],
): Record<string, string> {
  if (verb.write || mode === "private") {
    return { "cache-control": "private, no-store" }
  }
  const cdn = `public, max-age=${READ_MAX_AGE}, stale-while-revalidate=${READ_STALE}`
  return {
    "cache-control": "public, max-age=0, must-revalidate",
    "cdn-cache-control": cdn,
    "netlify-cdn-cache-control": `${cdn}, durable`,
    "cache-tag": tags.join(","),
    "netlify-cache-tag": tags.join(","),
  }
}
