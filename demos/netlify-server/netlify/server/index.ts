import { createServer } from "@forges-proxy/server"
import { purgeCache } from "@netlify/cache"

// Netlify Server takes a Fetchable as is, on every path by default.
export default createServer({
  anonymousForges: true,
  purge: (tags) => purgeCache({ tags }),
  // `durable` keeps a read in Netlify's shared cache tier; the prefixed headers apply only at Netlify's CDN.
  cdnHeaders: ({ cacheControl, tags }) => ({
    "netlify-cdn-cache-control": `${cacheControl}, durable`,
    "netlify-cache-tag": tags.join(","),
  }),
})
