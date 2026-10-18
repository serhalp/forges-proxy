import type { ForgeProvider } from "forges"
import { CAPABILITY_TABLE } from "forges/kit"

export interface VerbInfo {
  /** Changes state on the forge: POST only, never cached. */
  write: boolean
  /** Needs an account, so it reads data private to the credential. */
  account: boolean
}

/**
 * Verbs with no safe or meaningful HTTP form: `installations.token` mints credentials, `installations.provider(s)`
 * return live providers, and webhooks and push subscriptions get their own endpoints.
 */
const EXCLUDED = new Set([
  "installations.token",
  "installations.provider",
  "installations.providers",
  "webhooks.verify",
  "webhooks.ingest",
  "sources.subscribe",
])

const entries = CAPABILITY_TABLE.flatMap((entry) =>
  (entry.verbs ?? []).map(
    (verb) => [verb, { write: !!entry.write, account: !!entry.account }] as const,
  ),
)
const names = new Set(entries.map(([verb]) => verb))

/** Every verb callable over HTTP. Iterables are left out for their `*Page` form, which clients page through. */
export const VERBS: ReadonlyMap<string, VerbInfo> = new Map(
  entries.filter(([verb]) => !EXCLUDED.has(verb) && !names.has(`${verb}Page`)),
)

type Namespaces = Record<string, Record<string, (...args: unknown[]) => unknown>>

export function callVerb(provider: ForgeProvider, verb: string, args: unknown[]): unknown {
  const [namespace, name] = verb.split(".") as [string, string]
  return (provider as unknown as Namespaces)[namespace]![name]!(...args)
}
