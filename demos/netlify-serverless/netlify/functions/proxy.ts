import { createServer } from "@forges-proxy/server"
import { purgeCache } from "@netlify/cache"
import type { Config } from "@netlify/functions"
import { initLogger, log } from "evlog"

initLogger({ env: { service: "forges-proxy" } })

export default createServer({
  anonymousForges: true,
  purge: (tags) => purgeCache({ tags }),
  // `durable` stores responses in Netlify's shared durable cache tier.
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

export const config: Config = { path: "/*" }
