import { defineHandler } from "nitro"
import { accessMode } from "#server/utils/access.ts"
import { skippedProviders, useForges } from "#server/utils/forges.ts"
import { VERBS } from "#server/utils/verbs.ts"

/** The configured providers with their capabilities, and the verbs this instance routes. */
export default defineHandler(() => {
  const mode = accessMode()
  return {
    mode,
    providers: useForges().providers.map((provider) => ({
      forge: provider.forge,
      instance: provider.instance,
      authKind: provider.authKind,
      capabilities: provider.capabilities,
    })),
    verbs: [...VERBS]
      .filter(([, verb]) => mode === "private" || !(verb.write || verb.account))
      .map(([name, verb]) => ({ name, ...verb })),
    // Only a private instance says which env sets were skipped; it describes the operator's configuration.
    ...(mode === "private" ? { skipped: skippedProviders() } : {}),
  }
})
