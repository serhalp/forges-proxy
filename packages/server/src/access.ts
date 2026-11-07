import { HTTPError } from "h3"
import type { Env } from "#src/context.ts"

/**
 * `private`: callers present `FORGES_PROXY_SECRET`. `public`: anyone may call, and only verbs that need neither
 * an account nor write access are routed, so the instance's tokens should only be able to read public data.
 */
export type AccessMode = "private" | "public"

export function accessMode(env: Env): AccessMode {
  const secret = env.FORGES_PROXY_SECRET
  const isPublic = env.FORGES_PROXY_PUBLIC === "1" || env.FORGES_PROXY_PUBLIC === "true"
  // Refuse to guess: an instance with neither would hand the env's tokens to anyone who finds it.
  if (secret && isPublic) {
    throw new HTTPError("Set only one of FORGES_PROXY_SECRET and FORGES_PROXY_PUBLIC", {
      status: 503,
    })
  }
  if (secret) {
    return "private"
  }
  if (isPublic) {
    return "public"
  }
  throw new HTTPError(
    "Set FORGES_PROXY_SECRET, or FORGES_PROXY_PUBLIC=1 for a public read-only instance",
    {
      status: 503,
    },
  )
}
