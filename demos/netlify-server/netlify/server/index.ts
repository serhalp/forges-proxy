import { createServer } from "@forges-proxy/server"
import { purgeCache } from "@netlify/cache"
import { initLogger, log } from "evlog"

initLogger({ env: { service: "forges-proxy" } })

// Netlify Server takes a Fetchable as is, on every path by default.
export default createServer({
  anonymousForges: true,
  purge: (tags) => purgeCache({ tags }),
  // `durable` keeps a read in Netlify's shared cache tier; the prefixed headers apply only at Netlify's CDN.
  cdnHeaders: ({ cacheControl, tags }) => ({
    "netlify-cdn-cache-control": `${cacheControl}, durable`,
    "netlify-cache-tag": tags.join(","),
  }),
  logger: log,
  // Each verified webhook delivery's events, after its purge. Swap in your own handling.
  handleEvents: (events, { forge, instance }) => {
    for (const { kind, action, summary } of events)
      log.info({ forge, instance, kind, action, summary })
  },
})
