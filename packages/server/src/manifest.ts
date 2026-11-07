import * as v from "valibot"
import generated from "#src/manifest.json" with { type: "json" }

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
  /** Answers with one `Page` of a listing; the options carry the cursor of the next. */
  listing?: true
  params: ManifestParam[]
  /** The result may be a byte stream, sent as `application/octet-stream`. */
  stream?: true
  result: Schema
}

/** Each routed verb's signature and schemas, generated from the `forges` types by `scripts/generate-manifest.ts`. */
export interface Manifest {
  /** The `forges` version the manifest was generated from, which the proxy reports to clients. */
  forges: string
  verbs: Record<string, ManifestVerb>
  /** Referenced as `#/components/schemas/<Type>`. */
  schemas: Record<string, Schema>
}

const SchemaObject = v.record(v.string(), v.unknown())

// Checked against the interfaces above, which carry the docs.
const ManifestSchema: v.GenericSchema<Manifest> = v.object({
  forges: v.string(),
  verbs: v.record(
    v.string(),
    v.object({
      summary: v.optional(v.string()),
      write: v.boolean(),
      account: v.boolean(),
      listing: v.optional(v.literal(true)),
      params: v.array(
        v.object({
          name: v.string(),
          optional: v.boolean(),
          options: v.optional(v.literal(true)),
          description: v.optional(v.string()),
          schema: SchemaObject,
        }),
      ),
      stream: v.optional(v.literal(true)),
      result: SchemaObject,
    }),
  ),
  schemas: v.record(v.string(), SchemaObject),
})

export const manifest = v.parse(ManifestSchema, generated)

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
