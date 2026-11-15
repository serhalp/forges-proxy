import { models, verbs } from "forges/schema"
import forgesPackage from "forges/package.json" with { type: "json" }
import type { Schema, VerbSignature } from "forges/schema"

export type { Schema, VerbSignature }

/** Each routed verb's signature and schemas, from `forges/schema`. */
export interface Manifest {
  /** The `forges` version the manifest comes from, which the proxy reports to clients. */
  forges: string
  verbs: Record<string, VerbSignature>
  /** Referenced as `#/components/schemas/<Type>`. */
  schemas: Record<string, Schema>
}

/** Verbs with no safe or meaningful HTTP form: credentials, live providers, and webhook/push ingestion. */
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
 * The positional arguments as a tuple. Trailing optional ones may be left out, and any optional one may be `null`,
 * which is how JSON carries an `undefined` that a later argument follows.
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
