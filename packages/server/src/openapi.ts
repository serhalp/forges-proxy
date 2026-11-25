import type { AccessMode } from "./access.ts"
import type { VerbSignature, Schema } from "./manifest.ts"
import { argsSchema, manifest } from "./manifest.ts"
import { isRouted } from "./verbs.ts"
import { accessNote, CALLING, CLIENT_URL, SOURCE_URL, SUMMARY } from "./copy.ts"
import serverPackage from "../package.json" with { type: "json" }

const ERROR: Schema = {
  type: "object",
  properties: {
    error: {
      type: "object",
      properties: { name: { type: "string" }, message: { type: "string" } },
      required: ["name", "message"],
      additionalProperties: true,
      description:
        "Serialized `ForgeError` class name, message, and metadata used by `discoverProviders()` to reconstruct the error.",
    },
  },
  required: ["error"],
}

// `sources.stream` is defined separately from the JSON verb manifest because it returns `text/event-stream`.
const STREAM = {
  operationId: "sources_stream",
  tags: ["sources"],
  summary: "sources.stream",
  description:
    "Streams live forge events as Server-Sent Events. Each event's `id` is its cursor and `data` is a JSON-encoded `ForgeEvent`. Upstream errors emit an `error` event before closing. Serverless platforms terminate long-lived connections at their execution timeout; reconnect using the last cursor.",
  parameters: [
    {
      name: "Last-Event-ID",
      in: "header",
      description: "Cursor to resume from (sent automatically by `EventSource` on reconnect).",
      schema: { type: "string" },
    },
    {
      name: "cursor",
      in: "query",
      description: "Cursor to resume from when the `Last-Event-ID` header cannot be set.",
      schema: { type: "string" },
    },
  ],
  responses: {
    200: {
      description: "Server-Sent Events stream.",
      content: { "text/event-stream": { schema: { type: "string" } } },
    },
    default: {
      description:
        "Serialized `ForgeError` (e.g. `UnsupportedOperationError` when the forge does not support streaming).",
      content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
    },
  },
}

/**
 * Generates an OpenAPI 3.1 document for the proxy. In public mode, unrouted verbs are omitted and
 * path parameters enumerate the configured forges and instances.
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
      description: "Forge instance hostname, e.g. `github.com`.",
      schema: { type: "string", ...enumOf(providers.map((p) => p.instance)) },
    },
  ]
  return {
    openapi: "3.1.0",
    // Relative server URL so proxies mounted under a subpath resolve endpoints relative to `/openapi.json`.
    servers: [{ url: "." }],
    info: {
      title: "forges-proxy",
      version: serverPackage.version,
      "x-forges-version": manifest.forges,
      description: intro(mode),
    },
    ...(mode === "private"
      ? {
          components: {
            schemas: { ...SCHEMAS, Error: ERROR },
            securitySchemes: { secret: { type: "http", scheme: "bearer" } },
          },
          security: [{ secret: [] }],
        }
      : { components: { schemas: { ...SCHEMAS, Error: ERROR } } }),
    tags: [...new Set([...verbs.map(([name]) => name.split(".")[0]), "sources"])].map((name) => ({
      name,
    })),
    paths: {
      ...Object.fromEntries(
        verbs.map(([name, verb]) => [
          `/{forge}/{instance}/${name}`,
          { parameters: pathParams, [verb.write ? "post" : "get"]: operation(name, verb) },
        ]),
      ),
      "/{forge}/{instance}/sources.stream": { parameters: pathParams, get: STREAM },
    },
  }
}

// Responses strip `raw` unless `?raw=1` is passed, so mark `raw` optional in all response schemas.
const SCHEMAS: Record<string, Schema> = Object.fromEntries(
  Object.entries(manifest.schemas).map(([name, schema]) => [name, withoutRequiredRaw(schema)]),
)

function withoutRequiredRaw(schema: Schema): Schema {
  const copy = Object.fromEntries(
    Object.entries(schema).map(([key, child]) => [key, withoutRequiredRawIn(child)]),
  )
  if (Array.isArray(copy.required) && isSchema(copy.properties) && "raw" in copy.properties) {
    copy.required = copy.required.filter((name) => name !== "raw")
  }
  return copy
}

function withoutRequiredRawIn(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutRequiredRawIn)
  return isSchema(value) ? withoutRequiredRaw(value) : value
}

function operation(name: string, verb: VerbSignature): Record<string, unknown> {
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
                "Set to `1` to include each model's `raw` upstream forge payload (omitted by default).",
              schema: { type: "string", enum: ["1"] },
            },
          ],
        }),
    responses: responses(verb),
  }
}

/** Formats positional parameter names as text for OpenAPI viewers (like Scalar) that do not render tuple `prefixItems`. */
function signature(verb: VerbSignature): string {
  return `\`[${verb.params.map((param) => `${param.name}${param.optional ? "?" : ""}`).join(", ")}]\``
}

function isSchema(value: unknown): value is Schema {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isEmpty(schema: Schema): boolean {
  return schema.type === "null" || JSON.stringify(schema) === '{"not":{}}'
}

function responses(verb: VerbSignature): Record<string, unknown> {
  const { anyOf } = verb.result
  const branches = Array.isArray(anyOf) ? anyOf.filter(isSchema) : [verb.result]
  const json = branches.filter((schema) => !isEmpty(schema) && schema.format !== "binary")
  return {
    ...(json.length || verb.stream
      ? {
          200: {
            description: "Operation result.",
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
    ...(branches.some(isEmpty) ? { 204: { description: "No content." } } : {}),
    default: {
      description: "Serialized `ForgeError`.",
      content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
    },
  }
}

function intro(mode: AccessMode): string {
  return `${SUMMARY}

${accessNote(mode)}

## Calling a verb

${CALLING}

## From TypeScript

[\`@forges-proxy/client\`](${CLIENT_URL}) turns this proxy back into \`forges\` providers, so code written against \`forges\` works unchanged.

[Source and documentation](${SOURCE_URL})`
}
