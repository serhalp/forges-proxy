import type { FetchLike, Forges, KnownForgeKind } from "forges"
import { createForges } from "forges"
import { providersFromEnv } from "forges/env"
import type { Env, Logger } from "./context.ts"

// `satisfies` ensures a compile error when `forges` adds a new kind. Tangled is excluded (`false`) from
// anonymous defaults because its reads fetch caller-specified hosts (`did:web:`), creating an SSRF risk.
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
 * Builds the `Forges` registry from `env`. When `options.anonymous` is true, any forge not
 * configured in `env` that supports unauthenticated reads at its default instance is also enabled.
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
    // Only log skipped providers that were explicitly configured in `env`, not anonymous default probes.
    if (skipped && !(suffix === "" && defaults.includes(forge))) {
      options.logger.error({ message: "Provider skipped", forge, suffix, reason: skipped })
    }
  }
  return createForges(entries.flatMap((entry) => (entry.provider ? [entry.provider] : [])))
}

function prefix(kind: string): string {
  return `FORGES_${kind.toUpperCase().replaceAll("-", "_")}`
}
