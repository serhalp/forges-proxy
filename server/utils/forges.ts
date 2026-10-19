import type { Forges } from "forges"
import process from "node:process"
import { forgesFromEnv, providersFromEnv } from "forges/env"
import { cachingFetch } from "#server/utils/upstream-cache.ts"

const upstream = cachingFetch(globalThis.fetch)
let forges: Forges | undefined

/** Providers from `FORGES_<KIND>_<FIELD>[_<SUFFIX>]` variables; see `providersFromEnv()`. */
export function useForges(): Forges {
  return (forges ??= forgesFromEnv(process.env, { fetch: upstream }))
}

/** Makes the providers revalidate every upstream response they hold. */
export function expireUpstream(): void {
  upstream.expire()
}

/** Provider sets in the environment that could not be configured, by forge and reason only. */
export function skippedProviders(): Array<{ forge: string; suffix: string; reason: string }> {
  return providersFromEnv(process.env).flatMap((entry) =>
    entry.skipped ? [{ forge: entry.forge, suffix: entry.suffix, reason: entry.skipped }] : [],
  )
}
