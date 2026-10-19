import process from "node:process"
import { purgeCache } from "@netlify/functions"

export type Purge = (tags: string[]) => Promise<void>

// Cloudflare accepts at most this many tags per purge request.
const CLOUDFLARE_BATCH = 30

/**
 * Purges CDN entries by cache tag, on the CDN the env names: Netlify, where functions get `NETLIFY_PURGE_API_TOKEN`,
 * or Cloudflare with `CLOUDFLARE_ZONE_ID` and `CLOUDFLARE_API_TOKEN`. Undefined elsewhere: entries expire by age.
 */
export function usePurge(env = process.env): Purge | undefined {
  if (env.NETLIFY_PURGE_API_TOKEN) {
    return (tags) => purgeCache({ tags })
  }
  const zone = env.CLOUDFLARE_ZONE_ID
  const token = env.CLOUDFLARE_API_TOKEN
  if (zone && token) {
    return async (tags) => {
      for (let start = 0; start < tags.length; start += CLOUDFLARE_BATCH) {
        const response = await fetch(
          `https://api.cloudflare.com/client/v4/zones/${encodeURIComponent(zone)}/purge_cache`,
          {
            method: "POST",
            headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
            body: JSON.stringify({ tags: tags.slice(start, start + CLOUDFLARE_BATCH) }),
          },
        )
        if (!response.ok) {
          throw new Error(`Cloudflare purge failed with ${response.status}`)
        }
      }
    }
  }
  return undefined
}
