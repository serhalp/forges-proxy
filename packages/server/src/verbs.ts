import type { ForgeListing, ForgeProvider } from "forges"
import type { AccessMode } from "./access.ts"
import type { VerbSignature } from "./manifest.ts"
import { manifest } from "./manifest.ts"

// Read verbs that require elevated repository or organization permissions and are disabled on public instances.
const PRIVILEGED = new Set([
  "securityAlerts.list",
  "repos.collaborators",
  "repos.permissionFor",
  "repos.assignableUsers",
  "repos.reviewerCandidates",
  "repos.branchRules",
  "orgs.teams",
])

/** Returns true if `name` is routable in `mode` (public mode excludes writes, account verbs, and privileged reads). */
export function isRouted(
  name: string,
  verb: Pick<VerbSignature, "write" | "account">,
  mode: AccessMode,
): boolean {
  return mode === "private" || !(verb.write || verb.account || PRIVILEGED.has(name))
}

export function routedVerb(name: string, mode: AccessMode): VerbSignature | undefined {
  const verb = Object.hasOwn(manifest.verbs, name) ? manifest.verbs[name] : undefined
  return verb && isRouted(name, verb, mode) ? verb : undefined
}

/** Invokes `name` on `provider` with `args`. For listing verbs, returns the single page from `.page()`. */
export function callVerb(
  provider: ForgeProvider,
  name: string,
  verb: Pick<VerbSignature, "listing">,
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

/** Injects `signal` into the verb's options argument so aborted HTTP requests cancel in-flight upstream requests. */
export function withSignal(verb: VerbSignature, args: unknown[], signal: AbortSignal): unknown[] {
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
