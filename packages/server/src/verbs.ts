import type { ForgeListing, ForgeProvider } from "forges"
import type { AccessMode } from "#src/access.ts"
import type { ManifestVerb } from "#src/manifest.ts"
import { manifest } from "#src/manifest.ts"

/** Public instances route no writes or account verbs, so their tokens only ever read public data. */
export function isRouted(verb: Pick<ManifestVerb, "write" | "account">, mode: AccessMode): boolean {
  return mode === "private" || !(verb.write || verb.account)
}

/** The verb, when this instance routes it. */
export function routedVerb(name: string, mode: AccessMode): ManifestVerb | undefined {
  const verb = Object.hasOwn(manifest.verbs, name) ? manifest.verbs[name] : undefined
  return verb && isRouted(verb, mode) ? verb : undefined
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
