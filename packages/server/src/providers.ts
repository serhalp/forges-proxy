import type { FetchLike, Forges, KnownForgeKind } from "forges"
import { createForges } from "forges"
import { providersFromEnv } from "forges/env"
import type { Env, Logger } from "./context.ts"

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
  gitcafe: true,
  gitea: true,
  gitee: true,
  github: true,
  gitlab: true,
  pushin: true,
  sourcehut: true,
  tangled: false,
  upstream: true,
} satisfies Record<KnownForgeKind, boolean>).flatMap(([kind, include]) => (include ? [kind] : []))

/**
 * The providers `env` configures. With `anonymous`, also every forge the env doesn't mention that `forges` can reach
 * at its default instance without credentials.
 */
export function providers(
  env: Env,
  options: { fetch: FetchLike; anonymous: boolean; logger: Logger },
): Forges {
  const defaults = options.anonymous
    ? KINDS.filter((kind) => !Object.keys(env).some((key) => key.startsWith(`${prefix(kind)}_`)))
    : []
  const entries = providersFromEnv(
    { ...env, ...Object.fromEntries(defaults.map((kind) => [`${prefix(kind)}_ENABLED`, "1"])) },
    { fetch: options.fetch },
  )
  for (const { forge, suffix, skipped } of entries) {
    // A default that needs more than `ENABLED` (a base URL, credentials) is expected to fall out.
    if (skipped && !(suffix === "" && defaults.includes(forge))) {
      options.logger.error({ message: "Provider skipped", forge, suffix, reason: skipped })
    }
  }
  return createForges(entries.flatMap((entry) => (entry.provider ? [entry.provider] : [])))
}

function prefix(kind: string): string {
  return `FORGES_${kind.toUpperCase().replaceAll("-", "_")}`
}
