import { createServer } from "@forges-proxy/server"
import type { Config } from "@netlify/functions"
import { purgeCache } from "@netlify/functions"
import { initLogger, log } from "evlog"

initLogger({ env: { service: "forges-proxy" } })

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

export const config: Config = { path: "/*" }
