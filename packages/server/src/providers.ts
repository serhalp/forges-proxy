import type { FetchLike, Forges, KnownForgeKind } from "forges"
import { createForges } from "forges"
import { providersFromEnv } from "forges/env"
import type { Env } from "#src/context.ts"

// Every kind `forges` knows; the `satisfies` breaks the build when it gains one. `false` keeps a kind out of the
// anonymous defaults: Tangled reads hosts that callers name (`did:web:`), so it'd let anyone aim the proxy anywhere.
const KINDS = Object.entries({
  "azure-devops": true,
  bitbucket: true,
  "cloudflare-artifacts": true,
  "cursor-origin": true,
  entire: true,
  forgejo: true,
  gitbucket: true,
  gitea: true,
  gitee: true,
  github: true,
  gitlab: true,
  pushin: true,
  sourcehut: true,
  tangled: false,
} satisfies Record<KnownForgeKind, boolean>).flatMap(([kind, include]) => (include ? [kind] : []))

/**
 * The providers `env` configures. With `anonymous`, also every forge the env doesn't mention that `forges` can reach
 * at its default instance without credentials.
 */
export function providers(env: Env, options: { fetch: FetchLike; anonymous: boolean }): Forges {
  if (!options.anonymous) {
    return createForges(configured(env, options.fetch))
  }
  const defaults = Object.fromEntries(
    KINDS.map((kind) => `FORGES_${kind.toUpperCase().replaceAll("-", "_")}`)
      .filter((prefix) => !Object.keys(env).some((key) => key.startsWith(`${prefix}_`)))
      .map((prefix) => [`${prefix}_ENABLED`, "1"]),
  )
  // A forge that needs more than `ENABLED` (a base URL, credentials) is skipped, and left out.
  return createForges(configured({ ...env, ...defaults }, options.fetch))
}

function configured(env: Env, fetch: FetchLike) {
  return providersFromEnv(env, { fetch }).flatMap((entry) =>
    entry.provider ? [entry.provider] : [],
  )
}
