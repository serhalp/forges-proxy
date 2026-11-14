import { createServer } from "@forges-proxy/server"
import { initLogger, log } from "evlog"

initLogger({ env: { service: "forges-proxy" } })

export default createServer({
  anonymousForges: true,
  logger: log,
  // Each verified webhook delivery's events. Swap in your own handling.
  handleEvents: (events, { forge, instance }) => {
    for (const { kind, action, summary } of events)
      log.info({ forge, instance, kind, action, summary })
  },
})
