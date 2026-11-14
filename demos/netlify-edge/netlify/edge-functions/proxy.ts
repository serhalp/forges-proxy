import { createServer } from "@forges-proxy/server"
import type { Config } from "@netlify/edge-functions"
import { initLogger, log } from "evlog"

initLogger({ env: { service: "forges-proxy" } })

// No `purge`: CDN entries expire by age.
// TODO: export the server itself once Edge Functions take a Fetchable.
export default createServer({
  env: Netlify.env.toObject(),
  anonymousForges: true,
  cdnHeaders: ({ cacheControl, tags }) => ({
    "netlify-cdn-cache-control": `${cacheControl}, durable`,
    "netlify-cache-tag": tags.join(","),
  }),
  logger: log,
  // Each verified webhook delivery's events. Swap in your own handling.
  handleEvents: (events, { forge, instance }) => {
    for (const { kind, action, summary } of events)
      log.info({ forge, instance, kind, action, summary })
  },
}).fetch

// Edge function responses are only cached when they opt in.
export const config: Config = { path: "/*", cache: "manual" }
