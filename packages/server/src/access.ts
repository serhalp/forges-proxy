import { HTTPError } from "h3"
import type { Env } from "./context.ts"

/**
 * - `private`: requires `FORGES_PROXY_SECRET` (or `FORGES_PROXY_PREVIOUS_SECRET` during key rotation) and routes all verbs.
 * - `public`: unauthenticated; routes only public, non-account, non-privileged read verbs.
 */
export type AccessMode = "private" | "public"

export function accessMode(env: Env): AccessMode {
  const secret = env.FORGES_PROXY_SECRET
  const isPublic = env.FORGES_PROXY_PUBLIC === "1" || env.FORGES_PROXY_PUBLIC === "true"
  // Fail closed with 503 if access mode is unset or ambiguous so credentials are never exposed by accident.
  if (env.FORGES_PROXY_PREVIOUS_SECRET && !secret) {
    throw new HTTPError(
      "FORGES_PROXY_PREVIOUS_SECRET requires FORGES_PROXY_SECRET to be set alongside it",
      {
        status: 503,
      },
    )
  }
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
