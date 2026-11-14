import process from "node:process"
import { createServer } from "@forges-proxy/server"
import { serve } from "srvx"
import { initLogger, log } from "evlog"

initLogger({ env: { service: "forges-proxy" } })

serve({
  fetch: createServer({
    anonymousForges: true,
    logger: log,
    // Each verified webhook delivery's events. Swap in your own handling.
    handleEvents: (events, { forge, instance }) => {
      for (const { kind, action, summary } of events)
        log.info({ forge, instance, kind, action, summary })
    },
  }).fetch,
  port: Number(process.env.PORT ?? 3000),
})
