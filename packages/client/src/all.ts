import type { KnownForgeKind } from "forges"
import {
  azureDevOps,
  bitbucket,
  cloudflareArtifacts,
  cursorOrigin,
  entire,
  forgejo,
  gitbucket,
  gitea,
  gitee,
  github,
  gitlab,
  pushin,
  sourcehut,
  tangled,
} from "forges"
import type { ProviderFactory } from "./remote.ts"

// The `satisfies` breaks the build when `forges` gains a kind.
const BY_KIND = {
  "azure-devops": azureDevOps,
  bitbucket,
  "cloudflare-artifacts": cloudflareArtifacts,
  "cursor-origin": cursorOrigin,
  entire,
  forgejo,
  gitbucket,
  gitea,
  gitee,
  github,
  gitlab,
  pushin,
  sourcehut,
  tangled,
} satisfies Record<KnownForgeKind, ProviderFactory>

/** Every `forges` provider factory, for `connect({ factories: allFactories })`. Bundles every forge. */
export const allFactories: readonly ProviderFactory[] = Object.values(BY_KIND)
