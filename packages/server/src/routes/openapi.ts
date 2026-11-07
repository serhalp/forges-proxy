import type { EventHandler } from "h3"
import { accessMode } from "#src/access.ts"
import type { Context } from "#src/context.ts"
import { openApi } from "#src/openapi.ts"

export function openapiRoute(context: Context): EventHandler {
  return (event) => {
    const mode = accessMode(context.env)
    event.res.headers.set(
      "cache-control",
      mode === "public" ? "public, max-age=300" : "private, no-store",
    )
    return openApi(mode, context.forges().providers)
  }
}
