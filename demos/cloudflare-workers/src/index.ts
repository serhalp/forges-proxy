import { createServer } from "@forges-proxy/server"
import { log } from "evlog"
import { initWorkersLogger } from "evlog/workers"

initWorkersLogger({ env: { service: "forges-proxy" } })

const server = createServer({
  anonymousForges: true,
  logger: log,
  handleEvents: (events, { forge, instance }) => {
    for (const { kind, action, summary } of events)
      log.info({ forge, instance, kind, action, summary })
  },
})

interface Env {
  RATE_LIMITER: { limit: (options: { key: string }) => Promise<{ success: boolean }> }
}

export default {
  // Per client: generous for apps and agents, but caps one caller burning the forge tokens' budget.
  async fetch(request: Request, env: Env): Promise<Response> {
    const key = request.headers.get("cf-connecting-ip") ?? ""
    const { success } = await env.RATE_LIMITER.limit({ key })
    if (!success) {
      return Response.json(
        { error: { name: "ProxyError", message: "Too many requests; try again in a minute" } },
        { status: 429, headers: { "retry-after": "60", "access-control-allow-origin": "*" } },
      )
    }
    return server.fetch(request)
  },
}
