import { createServer } from "@forges-proxy/server"
import { initLogger, log } from "evlog"

initLogger({ env: { service: "forges-proxy" } })

export default createServer({
  anonymousForges: true,
  logger: log,
  handleEvents: (events, { forge, instance }) => {
    for (const { kind, action, summary } of events)
      log.info({ forge, instance, kind, action, summary })
  },
})
