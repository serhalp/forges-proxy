import { cacheApiStore, createServer } from "@forges-proxy/server"
import type { Config } from "@netlify/functions"
import { purgeCache } from "@netlify/functions"

export default createServer({
  anonymousForges: true,
  // Shared by every function instance in a region, and purged by the same cache tags as the CDN.
  upstreamStore: cacheApiStore(() => caches.open("upstream")),
  purge: (tags) => purgeCache({ tags }),
  // `durable` keeps a read in Netlify's shared cache tier; the prefixed headers apply only at Netlify's CDN.
  cdnHeaders: ({ cacheControl, tags }) => ({
    "netlify-cdn-cache-control": `${cacheControl}, durable`,
    "netlify-cache-tag": tags.join(","),
  }),
})

export const config: Config = { path: "/*" }
