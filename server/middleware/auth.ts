import process from "node:process"
import { timingSafeEqual } from "forges/kit"
import { defineMiddleware } from "nitro"
import { accessMode } from "#server/utils/access.ts"
import { proxyError } from "#server/utils/errors.ts"

// Webhooks are verified by their signatures instead.
const OPEN = /^\/(?:docs|openapi\.json)$|^\/webhooks\//

export default defineMiddleware((event) => {
  if (OPEN.test(event.url.pathname) || accessMode() === "public") {
    return
  }
  const header = event.req.headers.get("authorization") ?? ""
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : ""
  if (!token || !timingSafeEqual(token, process.env.FORGES_PROXY_SECRET!)) {
    return proxyError(401, "Unauthorized", { "www-authenticate": "Bearer" })
  }
  return undefined
})
