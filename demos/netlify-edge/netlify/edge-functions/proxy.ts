import { createServer } from "@forges-proxy/server"
import type { Config } from "@netlify/edge-functions"
import { initLogger, log } from "evlog"

initLogger({ env: { service: "forges-proxy" } })

// Edge functions do not configure `purge`; cached CDN entries expire via TTL.
export default createServer({
  env: Netlify.env.toObject(),
  anonymousForges: true,
  cdnHeaders: ({ cacheControl, tags }) => ({
    "netlify-cdn-cache-control": `${cacheControl}, durable`,
    "netlify-cache-tag": tags.join(","),
  }),
  logger: log,
  handleEvents: (events, { forge, instance }) => {
    for (const { kind, action, summary } of events)
      log.info({ forge, instance, kind, action, summary })
  },
})

// Enable opt-in CDN response caching for this edge function.
export const config: Config = {
  path: "/*",
  cache: "manual",
  // Per client: generous for apps and agents, but caps one caller burning the forge tokens' budget.
  rateLimit: { windowLimit: 600, windowSize: 60, aggregateBy: ["ip", "domain"] },
}
