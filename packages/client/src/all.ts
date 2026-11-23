import type { KnownForgeKind } from "forges"
import {
  azureDevOps,
  bitbucket,
  cloudflareArtifacts,
  cursorOrigin,
  entire,
  forgejo,
  gitbucket,
  gitcafe,
  gitea,
  gitee,
  github,
  gitlab,
  pushin,
  sourcehut,
  tangled,
  upstream,
} from "forges"
import type { ProviderFactory } from "./remote.ts"

// `satisfies` ensures a compile error when `forges` adds a new kind.
const BY_KIND = {
  "azure-devops": azureDevOps,
  bitbucket,
  "cloudflare-artifacts": cloudflareArtifacts,
  "cursor-origin": cursorOrigin,
  entire,
  forgejo,
  gitbucket,
  gitcafe,
  gitea,
  gitee,
  github,
  gitlab,
  pushin,
  sourcehut,
  tangled,
  upstream,
} satisfies Record<KnownForgeKind, ProviderFactory>

/** All built-in `forges` provider factories for `connect({ factories: allFactories })`. Bundles every forge provider. */
export const allFactories: readonly ProviderFactory[] = Object.values(BY_KIND)
