import { models, verbs } from "forges/schema"
import forgesPackage from "forges/package.json" with { type: "json" }
import type { Schema, VerbSignature } from "forges/schema"

export type { Schema, VerbSignature }

export interface Manifest {
  /** Version of `forges` providing the verb signatures and schemas. */
  forges: string
  verbs: Record<string, VerbSignature>
  /** Model JSON Schemas referenced via `#/components/schemas/<Type>`. */
  schemas: Record<string, Schema>
}

/** Verbs excluded from generic RPC routing (credential minting, in-memory provider factories, webhooks, and SSE). */
const NON_ROUTABLE = new Set([
  "installations.token",
  "installations.provider",
  "installations.providers",
  "webhooks.verify",
  "webhooks.ingest",
  "sources.stream",
])

export const manifest: Manifest = {
  forges: forgesPackage.version,
  verbs: Object.fromEntries(Object.entries(verbs).filter(([name]) => !NON_ROUTABLE.has(name))),
  schemas: models,
}

/**
 * Builds a tuple JSON Schema for a verb's positional `args` array. Optional parameters also accept
 * `null` so callers can skip an optional argument before a later positional argument.
 */
export function argsSchema(verb: VerbSignature): Schema {
  return {
    type: "array",
    prefixItems: verb.params.map((param) => ({
      title: `${param.name}${param.optional ? "?" : ""}`,
      ...(param.description ? { description: param.description } : {}),
      ...(param.optional ? { anyOf: [param.schema, { type: "null" }] } : param.schema),
    })),
    minItems: verb.params.filter((param) => !param.optional).length,
    maxItems: verb.params.length,
  }
}
