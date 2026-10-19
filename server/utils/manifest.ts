import generated from "#server/manifest.json" with { type: "json" }

export type Schema = Record<string, unknown>

export interface ManifestParam {
  name: string
  optional: boolean
  /** The verb's options: where the proxy puts the request's `signal`. */
  options?: true
  description?: string
  schema: Schema
}

export interface ManifestVerb {
  summary?: string
  write: boolean
  account: boolean
  params: ManifestParam[]
  /** The result may be a byte stream, sent as `application/octet-stream`. */
  stream?: true
  result: Schema
}

/** Each routed verb's signature and schemas, generated from the `forges` types by `scripts/generate-manifest.ts`. */
export interface Manifest {
  verbs: Record<string, ManifestVerb>
  /** Referenced as `#/components/schemas/<Type>`. */
  schemas: Record<string, Schema>
}

export const manifest = generated as Manifest

/**
 * The positional arguments as a tuple. Trailing optional ones may be left out, and any optional one may be `null`,
 * which is how JSON carries an `undefined` that a later argument follows.
 */
export function argsSchema(verb: ManifestVerb): Schema {
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
