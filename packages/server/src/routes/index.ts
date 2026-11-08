import { providersFromEnv } from "forges/env"
import type { EventHandler } from "h3"
import { accessMode } from "#src/access.ts"
import type { Context } from "#src/context.ts"
import { manifest } from "#src/manifest.ts"
import { isRouted } from "#src/verbs.ts"

/**
 * The `forges` version, the configured providers with their capabilities, and the verbs this instance routes, each
 * with the position of its options, where clients put `signal` and a listing's cursor.
 */
export function indexRoute(context: Context): EventHandler {
  return () => {
    const mode = accessMode(context.env)
    return {
      mode,
      forges: manifest.forges,
      providers: context.forges().providers.map((provider) => ({
        forge: provider.forge,
        instance: provider.instance,
        baseUrl: provider.baseUrl,
        authKind: provider.authKind,
        capabilities: provider.capabilities,
      })),
      verbs: Object.entries(manifest.verbs)
        .filter(([name, verb]) => isRouted(name, verb, mode))
        .map(([name, verb]) => ({
          name,
          write: verb.write,
          account: verb.account,
          listing: !!verb.listing,
          options: verb.params.findIndex((param) => param.options),
        })),
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
