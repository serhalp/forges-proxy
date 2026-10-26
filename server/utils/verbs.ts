import type { ForgeListing, ForgeProvider } from "forges"
import type { AccessMode } from "#server/utils/access.ts"
import type { ManifestVerb } from "#server/utils/manifest.ts"
import { manifest } from "#server/utils/manifest.ts"

/** Public instances route no writes or account verbs, so their tokens only ever read public data. */
export function isRouted(verb: Pick<ManifestVerb, "write" | "account">, mode: AccessMode): boolean {
  return mode === "private" || !(verb.write || verb.account)
}

/** The verb, when this instance routes it. */
export function routedVerb(name: string, mode: AccessMode): ManifestVerb | undefined {
  const verb = Object.hasOwn(manifest.verbs, name) ? manifest.verbs[name] : undefined
  return verb && isRouted(verb, mode) ? verb : undefined
}

type Namespaces = Record<string, Record<string, (...args: unknown[]) => unknown>>

/** Calls `name` on `provider`; a listing answers with the page its options' cursor names. */
export function callVerb(
  provider: ForgeProvider,
  name: string,
  verb: Pick<ManifestVerb, "listing">,
  args: unknown[],
): unknown {
  const [namespace, method] = name.split(".") as [string, string]
  const result = (provider as unknown as Namespaces)[namespace]![method]!(...args)
  return verb.listing ? (result as ForgeListing<unknown>).page() : result
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
