import { providersFromEnv } from "forges/env"
import type { ForgeCapabilities, ForgeProvider } from "forges"
import type { EventHandler } from "h3"
import { accessMode } from "../access.ts"
import type { Context } from "../context.ts"
import { manifest } from "../manifest.ts"
import { isRouted } from "../verbs.ts"

const RETRY_MS = 5 * 60_000

/**
 * Returns the proxy's `forges` version, configured providers and their capabilities, and routed
 * verbs with their options parameter index (used by clients to inject `signal` and `cursor`).
 */
export function indexRoute(context: Context): EventHandler {
  // `refreshCapabilities()` queries the upstream forge on every call, so cache the result per
  // provider instance. If the request fails, fall back to static capabilities and retry after `RETRY_MS`.
  const refreshed = new WeakMap<
    ForgeProvider,
    { at: number; capabilities: Promise<ForgeCapabilities> }
  >()
  const capabilitiesOf = (provider: ForgeProvider) => {
    const cached = refreshed.get(provider)
    if (cached && (cached.at === Infinity || Date.now() - cached.at < RETRY_MS)) {
      return cached.capabilities
    }
    const entry = { at: Infinity, capabilities: provider.refreshCapabilities() }
    entry.capabilities = entry.capabilities.catch(() => {
      entry.at = Date.now()
      return provider.capabilities
    })
    refreshed.set(provider, entry)
    return entry.capabilities
  }
  return async () => {
    const mode = accessMode(context.env)
    const { providers } = context.forges()
    const capabilities = await Promise.all(providers.map(capabilitiesOf))
    return {
      mode,
      forges: manifest.forges,
      providers: providers.map((provider, index) => ({
        forge: provider.forge,
        instance: provider.instance,
        baseUrl: provider.baseUrl,
        authKind: provider.authKind,
        capabilities: capabilities[index],
      })),
      verbs: Object.entries(manifest.verbs)
        .filter(([name, verb]) => isRouted(name, verb, mode))
        .map(([name, verb]) => ({
          name,
          write: verb.write,
          account: verb.account,
          listing: !!verb.listing,
          options: verb.params.findIndex((param) => param.options),
        }))
        // `sources.stream` is excluded from the JSON verb manifest because it returns an SSE stream.
        .concat({
          name: "sources.stream",
          write: false,
          account: false,
          listing: false,
          options: 0,
        }),
      // Only expose skipped provider diagnostics on authenticated private instances.
      ...(mode === "private" ? { skipped: skippedProviders(context) } : {}),
    }
  }
}

/** Returns any `FORGES_*` environment variable groups that could not be initialized. */
function skippedProviders(
  context: Context,
): Array<{ forge: string; suffix: string; reason: string }> {
  return providersFromEnv(context.env).flatMap((entry) =>
    entry.skipped ? [{ forge: entry.forge, suffix: entry.suffix, reason: entry.skipped }] : [],
  )
}
