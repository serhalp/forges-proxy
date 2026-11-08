import { timingSafeEqual } from "forges/kit"
import type { Middleware } from "h3"
import { accessMode } from "#src/access.ts"
import type { Context } from "#src/context.ts"
import { proxyError } from "#src/errors.ts"

const OPEN = /^\/(?:docs|openapi\.json)$/
// Verified by their signatures instead.
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
    if (!token || !timingSafeEqual(token, context.env.FORGES_PROXY_SECRET!)) {
      return proxyError(401, "Unauthorized", { "www-authenticate": "Bearer" })
    }
    return undefined
  }
}
