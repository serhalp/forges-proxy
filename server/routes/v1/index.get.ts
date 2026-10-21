import { defineHandler } from "nitro"
import { accessMode } from "#server/utils/access.ts"
import { skippedProviders, useForges } from "#server/utils/forges.ts"
import { manifest } from "#server/utils/manifest.ts"
import { isRouted } from "#server/utils/verbs.ts"

/**
 * The configured providers with their capabilities, and the verbs this instance routes, with the position of each
 * one's options for clients to find their `signal` and a listing's options in.
 */
export default defineHandler(() => {
  const mode = accessMode()
  return {
    mode,
    providers: useForges().providers.map((provider) => ({
      forge: provider.forge,
      instance: provider.instance,
      baseUrl: provider.baseUrl,
      authKind: provider.authKind,
      capabilities: provider.capabilities,
    })),
    verbs: Object.entries(manifest.verbs)
      .filter(([, verb]) => isRouted(verb, mode))
      .map(([name, verb]) => ({
        name,
        write: verb.write,
        account: verb.account,
        options: verb.params.findIndex((param) => param.options),
      })),
    // Only a private instance says which env sets were skipped; it describes the operator's configuration.
    ...(mode === "private" ? { skipped: skippedProviders() } : {}),
  }
})
