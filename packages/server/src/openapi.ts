import type { AccessMode } from "#src/access.ts"
import type { ManifestVerb, Schema } from "#src/manifest.ts"
import { argsSchema, manifest } from "#src/manifest.ts"
import { isRouted } from "#src/verbs.ts"

const ERROR: Schema = {
  type: "object",
  properties: {
    error: {
      type: "object",
      properties: { name: { type: "string" }, message: { type: "string" } },
      required: ["name", "message"],
      additionalProperties: true,
      description:
        "The `ForgeError`'s class name, message and fields, which `connect()` rebuilds it from.",
    },
  },
  required: ["error"],
}

/**
 * The proxy's API as OpenAPI 3.1, from the operations manifest. A public instance leaves out what it doesn't route, and
 * names its forges and instances.
 */
export function openApi(
  mode: AccessMode,
  providers: Array<{ forge: string; instance: string }>,
): Record<string, unknown> {
  const verbs = Object.entries(manifest.verbs).filter(([name, verb]) => isRouted(name, verb, mode))
  const enumOf = (values: string[]) =>
    mode === "public" && values.length ? { enum: [...new Set(values)] } : {}
  const pathParams = [
    {
      name: "forge",
      in: "path",
      required: true,
      schema: { type: "string", ...enumOf(providers.map((p) => p.forge)) },
    },
    {
      name: "instance",
      in: "path",
      required: true,
      description: "The instance host, e.g. `github.com`.",
      schema: { type: "string", ...enumOf(providers.map((p) => p.instance)) },
    },
  ]
  return {
    openapi: "3.1.0",
    // Relative to this document, so a proxy mounted under a path prefix describes itself correctly.
    servers: [{ url: "." }],
    info: {
      title: "forges proxy",
      version: "0",
      "x-forges-version": manifest.forges,
      description:
        "Calls `forges` provider verbs over HTTP. Arguments are positional, as the verb takes them: a JSON array in `args`.",
    },
    ...(mode === "private"
      ? {
          components: {
            schemas: { ...manifest.schemas, Error: ERROR },
            securitySchemes: { secret: { type: "http", scheme: "bearer" } },
          },
          security: [{ secret: [] }],
        }
      : { components: { schemas: { ...manifest.schemas, Error: ERROR } } }),
    tags: [...new Set(verbs.map(([name]) => name.split(".")[0]))].map((name) => ({ name })),
    paths: Object.fromEntries(
      verbs.map(([name, verb]) => [
        `/{forge}/{instance}/${name}`,
        { parameters: pathParams, [verb.write ? "post" : "get"]: operation(name, verb) },
      ]),
    ),
  }
}

function operation(name: string, verb: ManifestVerb): Record<string, unknown> {
  const args = argsSchema(verb)
  const required = verb.params.some((param) => !param.optional)
  return {
    operationId: name.replace(".", "_"),
    tags: [name.split(".")[0]],
    summary: name,
    ...(verb.summary ? { description: verb.summary } : {}),
    ...(verb.write
      ? {
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { args: { description: signature(verb), ...args } },
                  ...(required ? { required: ["args"] } : {}),
                },
              },
            },
          },
        }
      : {
          parameters: [
            {
              name: "args",
              in: "query",
              required,
              description: signature(verb),
              content: { "application/json": { schema: args } },
            },
            {
              name: "raw",
              in: "query",
              description:
                "`1` keeps each model's `raw` forge payload, which is left out by default.",
              schema: { type: "string", enum: ["1"] },
            },
          ],
        }),
    responses: responses(verb),
  }
}

/** The positional arguments, by name, for viewers that don't render `prefixItems`. */
function signature(verb: ManifestVerb): string {
  return `\`[${verb.params.map((param) => `${param.name}${param.optional ? "?" : ""}`).join(", ")}]\``
}

function isSchema(value: unknown): value is Schema {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

// `undefined` results are a 204, and `void` is nothing but.
function isEmpty(schema: Schema): boolean {
  return schema.type === "null" || JSON.stringify(schema) === '{"not":{}}'
}

function responses(verb: ManifestVerb): Record<string, unknown> {
  const { anyOf } = verb.result
  const branches = Array.isArray(anyOf) ? anyOf.filter(isSchema) : [verb.result]
  const json = branches.filter((schema) => !isEmpty(schema) && schema.format !== "binary")
  return {
    ...(json.length || verb.stream
      ? {
          200: {
            description: "The verb's result.",
            content: {
              ...(json.length
                ? { "application/json": { schema: json.length === 1 ? json[0] : { anyOf: json } } }
                : {}),
              ...(verb.stream
                ? { "application/octet-stream": { schema: { type: "string", format: "binary" } } }
                : {}),
            },
          },
        }
      : {}),
    ...(branches.some(isEmpty) ? { 204: { description: "The verb returned nothing." } } : {}),
    default: {
      description: "A `ForgeError`, with the upstream status where there is one.",
      content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
    },
  }
}
