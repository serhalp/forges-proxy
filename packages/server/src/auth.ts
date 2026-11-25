import { timingSafeEqual } from "forges/kit"
import type { Middleware } from "h3"
import { accessMode } from "./access.ts"
import type { Context } from "./context.ts"
import { proxyError } from "./errors.ts"

const OPEN = /^\/(?:_docs|openapi\.json)?$/
// Webhook deliveries authenticate using the forge's webhook signature instead of the proxy secret.
const WEBHOOK = /^\/webhooks\/[^/]+\/[^/]+$/

export function auth(context: Context): Middleware {
  return (event) => {
    const { pathname } = event.url
    const open = OPEN.test(pathname) || (event.req.method === "POST" && WEBHOOK.test(pathname))
    if (open || accessMode(context.env) === "public") {
      return undefined
    }
    const header = event.req.headers.get("authorization") ?? ""
    const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : ""
    // Evaluate both active and previous secrets before branching to avoid timing leaks.
    const accepted = [context.env.FORGES_PROXY_SECRET, context.env.FORGES_PROXY_PREVIOUS_SECRET]
      .filter((secret) => !!secret)
      .map((secret) => timingSafeEqual(token, secret!))
    if (!token || !accepted.includes(true)) {
      return proxyError(401, "Unauthorized", { "www-authenticate": "Bearer" })
    }
    return undefined
  }
}
