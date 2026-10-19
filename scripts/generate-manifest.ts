/**
 * Generates the operations manifest: each routed verb's parameters, result and docs, with JSON Schemas (2020-12, as
 * OpenAPI 3.1 takes them) read from the `forges` types.
 *
 *   node scripts/generate-manifest.ts          writes server/manifest.json
 *   node scripts/generate-manifest.ts --check  exits 1 when server/manifest.json is stale
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import process from "node:process"
// The root `typescript` is the native port, which has no compiler API yet.
import ts from "typescript-5"
import type * as TS from "typescript-5"
import { createGenerator } from "ts-json-schema-generator"
import type { Manifest, ManifestParam, Schema } from "#server/utils/manifest.ts"
import { VERBS } from "#server/utils/verbs.ts"

const root = new URL("..", import.meta.url).pathname
const cache = `${root}node_modules/.cache/forges-proxy/`
const tsconfig = `${root}scripts/tsconfig.manifest.json`
const target = `${root}server/manifest.json`

const STREAM = "ByteStream"
const LIB_TYPES = new Set([
  "Array",
  "Omit",
  "Partial",
  "Pick",
  "Readonly",
  "Record",
  "Required",
  "Uint8Array",
])
const BYTES: Schema = {
  type: "string",
  contentEncoding: "base64",
  description: "Bytes, base64-encoded.",
}

interface Signature {
  params: Array<{
    name: string
    optional: boolean
    types: string[]
    doc?: string
    options: boolean
  }>
  result: string[]
}

export function generateManifest(): Manifest {
  mkdirSync(cache, { recursive: true })
  const entry = `${cache}provider.ts`
  writeFileSync(
    entry,
    `import type { ForgeProvider } from "forges"\nexport type Provider = ForgeProvider\n`,
  )
  const config = ts.getParsedCommandLineOfConfigFile(tsconfig, {}, ts.sys as never)!
  const program = ts.createProgram([entry], config.options)
  const checker = program.getTypeChecker()
  const file = program.getSourceFile(entry)!
  const [importDecl, alias] = file.statements as unknown as [
    TS.ImportDeclaration,
    TS.TypeAliasDeclaration,
  ]
  const provider = checker.getTypeAtLocation(alias.name)
  const exported = new Set(
    checker
      .getExportsOfModule(checker.getSymbolAtLocation(importDecl.moduleSpecifier)!)
      .map((s) => s.name),
  )

  const signatures = new Map<string, Signature & { summary?: string }>()
  for (const name of VERBS.keys()) {
    const [namespace, method] = name.split(".") as [string, string]
    const symbol = checker.getTypeOfSymbol(provider.getProperty(namespace)!).getProperty(method)!
    const overloads = checker.getTypeOfSymbol(symbol).getCallSignatures()
    const params: Signature["params"] = []
    for (const signature of overloads) {
      signature.getParameters().forEach((parameter, index) => {
        const declaration = parameter.valueDeclaration as TS.ParameterDeclaration
        const param = (params[index] ??= {
          name: parameter.name,
          optional: false,
          types: [],
          options: !!checker
            .getNonNullableType(checker.getTypeAtLocation(declaration))
            .getProperty("signal"),
          doc: ts
            .getJSDocParameterTags(declaration)
            .map((tag) => ts.getTextOfJSDocComment(tag.comment))
            .find(Boolean),
        })
        param.optional ||= !!declaration.questionToken
        param.types.push(declaration.type!.getText())
      })
    }
    // A parameter missing from some overloads is optional in all of them.
    for (const param of params.slice(Math.min(...overloads.map((o) => o.getParameters().length)))) {
      param.optional = true
    }
    const result = overloads.map((signature) => {
      const text = (signature.getDeclaration() as TS.SignatureDeclaration).type!.getText()
      return text
        .replace(/^Promise<([\s\S]*)>$/, "$1")
        .replaceAll("ReadableStream<Uint8Array>", STREAM)
    })
    for (const text of [...params.flatMap((p) => p.types), ...result]) {
      for (const [, used] of text.matchAll(/\b([A-Z]\w*)\b/g)) {
        if (used !== STREAM && !exported.has(used!) && !LIB_TYPES.has(used!)) {
          throw new Error(`${name} uses ${used}, which forges doesn't export`)
        }
      }
    }
    signatures.set(name, {
      params,
      result,
      summary: ts.displayPartsToString(symbol.getDocumentationComment(checker)) || undefined,
    })
  }

  // Every type the signatures name, as one alias each, for ts-json-schema-generator to resolve.
  const aliases = new Map<string, string>()
  const aliasOf = (types: string[]) => {
    const text = [...new Set(types)].map((type) => `(${type})`).join(" | ")
    const existing = [...aliases].find(([, value]) => value === text)?.[0]
    if (existing) {
      return existing
    }
    const name = `T${aliases.size}`
    aliases.set(name, text)
    return name
  }
  const plan = [...signatures].map(([name, signature]) => ({
    name,
    signature,
    params: signature.params.map((param) => aliasOf(param.types)),
    result: aliasOf(signature.result),
  }))
  const names = [...exported].filter((name) => /^[A-Z]/.test(name))
  const types = `${cache}types.ts`
  writeFileSync(
    types,
    [
      `import type { ${names.join(", ")} } from "forges"`,
      `export interface ${STREAM} {}`,
      ...[...aliases].map(([name, text]) => `export type ${name} = ${text}`),
    ].join("\n"),
  )
  const generator = createGenerator({
    path: types,
    tsconfig,
    expose: "export",
    skipTypeCheck: true,
    topRef: false,
    jsDoc: "extended",
    functions: "hide",
    additionalProperties: true,
  })
  const schemas: Record<string, Schema> = {}
  const inline = new Map<string, Schema>()
  for (const name of aliases.keys()) {
    const {
      definitions = {},
      $schema: _,
      ...schema
    } = generator.createSchema(name) as Schema & {
      definitions?: Record<string, Schema>
    }
    Object.assign(schemas, definitions)
    inline.set(name, schema)
  }
  delete schemas.AbortSignal
  delete schemas[STREAM]

  const tidy = (value: Schema): Schema => clean(value) as Schema
  return {
    verbs: Object.fromEntries(
      plan.map(({ name, signature, params, result }) => {
        const verb = VERBS.get(name)!
        const resultSchema = inline.get(result)!
        return [
          name,
          {
            ...(signature.summary ? { summary: signature.summary } : {}),
            write: verb.write,
            account: verb.account,
            params: signature.params.map((param, index): ManifestParam => ({
              name: param.name,
              optional: param.optional,
              ...(param.options ? { options: true } : {}),
              ...(param.doc ? { description: param.doc } : {}),
              schema: tidy(inline.get(params[index]!)!),
            })),
            ...(JSON.stringify(resultSchema).includes(`#/definitions/${STREAM}`)
              ? { stream: true }
              : {}),
            result: tidy(resultSchema),
          },
        ]
      }),
    ),
    schemas: Object.fromEntries(
      Object.keys(schemas)
        .sort()
        .map((name) => [componentName(name), tidy(schemas[name]!)]),
    ),
  }
}

/** OpenAPI component names allow only `[A-Za-z0-9._-]`: `Page<Repo>` becomes `PageOfRepo`. */
function componentName(name: string): string {
  return name.replace(/<(.+)>$/, "Of$1").replace(/[^\w.-]/g, "_")
}

/**
 * Draft-07 as the generator writes it, made what the wire carries: refs point at OpenAPI components, `signal` stays
 * on the server, bytes are base64 and streams are their own response.
 */
function clean(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(clean)
  }
  if (!value || typeof value !== "object") {
    return value
  }
  const schema = value as Schema
  if (schema.$ref === `#/definitions/${STREAM}`) {
    return {
      type: "string",
      format: "binary",
      description: "The bytes, as `application/octet-stream`.",
    }
  }
  const properties = schema.properties as Record<string, unknown> | undefined
  if (properties && "BYTES_PER_ELEMENT" in properties) {
    return BYTES
  }
  return Object.fromEntries(
    Object.entries(schema).flatMap(([key, item]) => {
      if (key === "$ref" && typeof item === "string") {
        return [
          [
            key,
            `#/components/schemas/${componentName(decodeURIComponent(item.replace(/^#\/definitions\//, "")))}`,
          ],
        ]
      }
      if (key === "properties" && item && typeof item === "object") {
        const { signal: _, ...rest } = item as Record<string, unknown>
        return [[key, clean(rest)]]
      }
      if (key === "description" && typeof item === "string") {
        return [[key, item.replace(/\{@link\s+([^\s}]+)\s*\}/g, "`$1`").replace(/ {2,}/g, " ")]]
      }
      return [[key, clean(item)]]
    }),
  )
}

if (import.meta.main) {
  const output = `${JSON.stringify(generateManifest(), null, 2)}\n`
  if (process.argv.includes("--check")) {
    if (readFileSync(target, "utf8") !== output) {
      console.error("server/manifest.json is stale; run node scripts/generate-manifest.ts")
      process.exitCode = 1
    }
  } else {
    writeFileSync(target, output)
  }
}
