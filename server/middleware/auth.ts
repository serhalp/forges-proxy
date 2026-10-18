import process from "node:process"
import { timingSafeEqual } from "forges/kit"
import { defineMiddleware } from "nitro"
import { accessMode } from "#server/utils/access.ts"
import { proxyError } from "#server/utils/errors.ts"

export default defineMiddleware((event) => {
  if (!event.url.pathname.startsWith("/v1") || accessMode() === "public") {
    return
  }
  const header = event.req.headers.get("authorization") ?? ""
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : ""
  if (!token || !timingSafeEqual(token, process.env.FORGES_PROXY_SECRET!)) {
    return proxyError(401, "Unauthorized", { "www-authenticate": "Bearer" })
  }
  return undefined
})
