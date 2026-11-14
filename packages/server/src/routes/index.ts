import { providersFromEnv } from "forges/env"
import type { ForgeCapabilities, ForgeProvider } from "forges"
import type { EventHandler } from "h3"
import { accessMode } from "../access.ts"
import type { Context } from "../context.ts"
import { manifest } from "../manifest.ts"
import { isRouted } from "../verbs.ts"

const RETRY_MS = 5 * 60_000

/**
 * The `forges` version, the configured providers with their capabilities, and the verbs this instance routes, each
 * with the position of its options, where clients put `signal` and a listing's cursor.
 */
export function indexRoute(context: Context): EventHandler {
  // Refined by the instance's version, which `refreshCapabilities()` requests on every call: once per provider and
  // server instance, then. A forge that doesn't answer keeps its static capabilities, and is asked again later.
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
        // Not in the manifest: it answers with server-sent events rather than JSON.
        .concat({
          name: "sources.stream",
          write: false,
          account: false,
          listing: false,
          options: 0,
        }),
      // Only a private instance says which env sets were skipped; it describes the operator's configuration.
      ...(mode === "private" ? { skipped: skippedProviders(context) } : {}),
    }
  }
}

/** Provider sets in the environment that could not be configured, by forge and reason only. */
function skippedProviders(
  context: Context,
): Array<{ forge: string; suffix: string; reason: string }> {
  return providersFromEnv(context.env).flatMap((entry) =>
    entry.skipped ? [{ forge: entry.forge, suffix: entry.suffix, reason: entry.skipped }] : [],
  )
}
