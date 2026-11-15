import type { ForgeListing, ForgeProvider } from "forges"
import type { AccessMode } from "./access.ts"
import type { ManifestVerb } from "./manifest.ts"
import { manifest } from "./manifest.ts"

// Reads that need more than public access (security alerts, who can push, admin settings), so a token with too much
// scope can't expose them to anyone.
const PRIVILEGED = new Set([
  "securityAlerts.list",
  "repos.collaborators",
  "repos.permissionFor",
  "repos.assignableUsers",
  "repos.reviewerCandidates",
  "repos.branchRules",
  "orgs.teams",
])

/** Public instances route no writes, account verbs, or privileged reads. */
export function isRouted(
  name: string,
  verb: Pick<ManifestVerb, "write" | "account">,
  mode: AccessMode,
): boolean {
  return mode === "private" || !(verb.write || verb.account || PRIVILEGED.has(name))
}

/** The verb, when this instance routes it. */
export function routedVerb(name: string, mode: AccessMode): ManifestVerb | undefined {
  const verb = Object.hasOwn(manifest.verbs, name) ? manifest.verbs[name] : undefined
  return verb && isRouted(name, verb, mode) ? verb : undefined
}

/** Calls `name` on `provider`; a listing answers with the page its options' cursor names. */
export function callVerb(
  provider: ForgeProvider,
  name: string,
  verb: Pick<ManifestVerb, "listing">,
  args: unknown[],
): unknown {
  const [namespace, method] = name.split(".")
  const target: unknown = Reflect.get(provider, namespace)
  const fn: unknown = typeof target === "object" && target ? Reflect.get(target, method) : undefined
  if (typeof fn !== "function") {
    throw new TypeError(`${name} is not a verb of ${provider.forge}`)
  }
  const result: unknown = Reflect.apply(fn, target, args)
  if (!verb.listing) {
    return result
  }
  if (!isListing(result)) {
    throw new TypeError(`${name} returned no listing`)
  }
  return result.page()
}

/** `args` with `signal` in the verb's options, so that a dropped request stops its upstream requests. */
export function withSignal(verb: ManifestVerb, args: unknown[], signal: AbortSignal): unknown[] {
  const index = verb.params.findIndex((param) => param.options)
  const options = args[index]
  if (index < 0 || (options !== undefined && (typeof options !== "object" || options === null))) {
    return args
  }
  return Array.from({ length: Math.max(args.length, index + 1) }, (_, at) =>
    at === index ? { ...options, signal } : args[at],
  )
}

function isListing(value: unknown): value is ForgeListing<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    "page" in value &&
    typeof value.page === "function"
  )
}
