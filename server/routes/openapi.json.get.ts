import { defineHandler } from "nitro"
import { accessMode } from "#server/utils/access.ts"
import { useForges } from "#server/utils/forges.ts"
import { openApi } from "#server/utils/openapi.ts"

export default defineHandler((event) => {
  const mode = accessMode()
  event.res.headers.set(
    "cache-control",
    mode === "public" ? "public, max-age=300" : "private, no-store",
  )
  return openApi(mode, useForges().providers)
})
