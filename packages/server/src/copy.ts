import type { KnownForgeKind } from "forges"
import type { AccessMode } from "./access.ts"

export const SUMMARY =
  "A self-hosted HTTP proxy and credential broker for [`forges`](https://forges.link). It holds forge tokens, caches public reads at the CDN, and exposes a single HTTP API across all configured forges."

export function accessNote(mode: AccessMode): string {
  return mode === "public"
    ? "This is a public, read-only instance: it routes no write or account verbs, nor reads that need elevated access."
    : "Send the proxy secret as `Authorization: Bearer <secret>`."
}

export const CALLING = `\`GET /{forge}/{instance}/{verb}?args=<json array>\` calls a read verb, and \`POST\` with \`{ "args": [...] }\` calls a write verb. \`args\` is a JSON array of positional arguments matching the \`ForgeProvider\` method signature, validated against the operation schema. Use \`null\` to skip an optional positional argument. Binary values are encoded as \`{ "$bytes": "<base64>" }\` and dates as \`{ "$date": "<ISO 8601>" }\`.

Listing endpoints return a single page (\`{ items, cursor }\`). Pass \`cursor\` back in the options argument to fetch the next page.`

export const CLIENT_URL = "https://npmx.dev/package/@forges-proxy/client"
export const SERVER_URL = "https://npmx.dev/package/@forges-proxy/server"
export const SOURCE_URL = "https://github.com/serhalp/forges-proxy"

// The `satisfies` breaks the build when `forges` gains a kind, so the landing page lists it.
const FORGE_NAMES = {
  "azure-devops": "Azure DevOps",
  bitbucket: "Bitbucket",
  "cloudflare-artifacts": "Cloudflare Artifacts",
  "cursor-origin": "Cursor Origin",
  entire: "Entire",
  forgejo: "Forgejo",
  gitbucket: "GitBucket",
  gitcafe: "GitCafe",
  gitea: "Gitea",
  gitee: "Gitee",
  github: "GitHub",
  gitlab: "GitLab",
  pushin: "Pushin",
  sourcehut: "SourceHut",
  tangled: "Tangled",
  upstream: "Upstream",
} satisfies Record<KnownForgeKind, string>

export const FORGE_KINDS: readonly string[] = Object.keys(FORGE_NAMES)

export function forgeName(forge: string): string {
  const names: Record<string, string> = FORGE_NAMES
  return Object.hasOwn(names, forge) ? names[forge] : forge
}
