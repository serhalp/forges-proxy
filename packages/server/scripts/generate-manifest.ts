/**
 * Generates the operations manifest: each routed verb's parameters, result and docs, with JSON Schemas (2020-12, as
 * OpenAPI 3.1 takes them) read from the `forges` types.
 *
 *   node scripts/generate-manifest.ts          writes src/manifest.json
 *   node scripts/generate-manifest.ts --check  exits 1 when src/manifest.json is stale
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import process from "node:process"
// The root `typescript` is the native port, which has no compiler API.
import ts from "typescript-6"
import type * as TS from "typescript-6"
import type {
  BaseType,
  ChainNodeParser,
  Definition,
  SubNodeParser,
  SubTypeFormatter,
} from "ts-json-schema-generator"
import {
  BaseType as Base,
  Context,
  createFormatter,
  createParser,
  DEFAULT_CONFIG,
  DefinitionType,
  NeverType,
  SchemaGenerator,
} from "ts-json-schema-generator"
import { CAPABILITY_TABLE } from "forges/kit"
import type { Manifest, ManifestParam, Schema } from "#src/manifest.ts"

const root = new URL("..", import.meta.url).pathname
const cache = `${root}node_modules/.cache/forges-proxy/`
const tsconfig = `${root}scripts/tsconfig.manifest.json`
const target = `${root}src/manifest.json`

const BYTES: Schema = {
  type: "object",
  properties: { $bytes: { type: "string", contentEncoding: "base64" } },
  required: ["$bytes"],
  additionalProperties: false,
  description: 'Bytes, as `{ "$bytes": "<base64>" }`.',
}
const STREAM: Schema = {
  type: "string",
  format: "binary",
  description: "The bytes, as `application/octet-stream`.",
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
  "sources.stream",
])

/** Every verb callable over HTTP, by class. A listing answers with one page, which clients page through. */
export function routableVerbs(): Map<
  string,
  { write: boolean; account: boolean; listing: boolean }
> {
  return new Map(
    CAPABILITY_TABLE.flatMap((entry) =>
      (entry.verbs ?? [])
        .filter((verb) => !EXCLUDED.has(verb))
        .map((verb) => [
          verb,
          {
            write: !!entry.write,
            account: !!entry.account,
            listing: !!entry.listings?.includes(verb),
          },
        ]),
    ),
  )
}

export function generateManifest(): Manifest {
  mkdirSync(cache, { recursive: true })
  const entry = `${cache}provider.ts`
  writeFileSync(
    entry,
    `import type { ForgeProvider } from "forges"\nexport type Provider = ForgeProvider\n`,
  )
  const options = ts.getParsedCommandLineOfConfigFile(tsconfig, {}, ts.sys as never)!.options
  const program = ts.createProgram([entry], options)
  const checker = program.getTypeChecker()
  const [importDecl, alias] = program.getSourceFile(entry)!.statements as unknown as [
    TS.ImportDeclaration,
    TS.TypeAliasDeclaration,
  ]
  const provider = checker.getTypeAtLocation(alias.name)
  const exports = checker.getExportsOfModule(
    checker.getSymbolAtLocation(importDecl.moduleSpecifier)!,
  )
  const exported = (name: string) =>
    checker.getAliasedSymbol(exports.find((symbol) => symbol.name === name)!)
  const schemas = schemaGenerator(program, {
    listing: exported("ForgeListing"),
    page: exported("Page").declarations![0]!,
  })

  // The published declarations are bundled without `export` keywords, so the generator names every type it meets.
  // Components are the types `forges` exports, and the rest, such as `Pick<…>` or a helper, are inlined.
  const names = new Set(exports.map((symbol) => symbol.name))
  const isComponent = (definition: string) => names.has(definition.replace(/<[\s\S]*$/, ""))
  const inline = (value: unknown, stack: string[] = []): Schema => {
    if (Array.isArray(value)) {
      return value.map((item) => inline(item, stack)) as never
    }
    if (!value || typeof value !== "object") {
      return value as never
    }
    const { $ref, ...rest } = value as Schema
    const name =
      typeof $ref === "string"
        ? decodeURIComponent($ref.replace(/^#\/definitions\//, ""))
        : undefined
    if (name && !isComponent(name)) {
      if (stack.includes(name)) {
        throw new Error(`${name} refers to itself, and forges doesn't export it to name it by`)
      }
      return { ...inline(schemas.definitions[name], [...stack, name]), ...inline(rest, stack) }
    }
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, inline(item, stack)]),
    )
  }

  const verbs = Object.fromEntries(
    [...routableVerbs()].map(([name, { write, account, listing }]) => {
      const [namespace, method] = name.split(".") as [string, string]
      const symbol = checker.getTypeOfSymbol(provider.getProperty(namespace)!).getProperty(method)!
      const overloads = checker
        .getTypeOfSymbol(symbol)
        .getCallSignatures()
        .map((signature) => signature.getDeclaration() as TS.SignatureDeclaration)
      const params: Array<Omit<ManifestParam, "schema"> & { types: TS.TypeNode[] }> = []
      for (const overload of overloads) {
        overload.parameters.forEach((declaration, index) => {
          const param = (params[index] ??= {
            name: declaration.name.getText(),
            optional: false,
            ...(checker
              .getNonNullableType(checker.getTypeAtLocation(declaration))
              .getProperty("signal")
              ? { options: true as const }
              : {}),
            ...docOf(declaration),
            types: [],
          })
          param.optional ||= !!declaration.questionToken
          param.types.push(declaration.type!)
        })
      }
      // A parameter missing from some overloads is optional in all of them.
      for (const param of params.slice(Math.min(...overloads.map((o) => o.parameters.length)))) {
        param.optional = true
      }
      const result = schemas.of(overloads.map((overload) => awaited(program, overload.type!)))
      const summary = ts.displayPartsToString(symbol.getDocumentationComment(checker))
      return [
        name,
        {
          ...(summary ? { summary } : {}),
          write,
          account,
          ...(listing ? { listing: true as const } : {}),
          params: params.map(({ types, ...param }) => ({
            ...param,
            schema: clean(inline(schemas.of(types))),
          })),
          ...(JSON.stringify(result).includes(JSON.stringify(STREAM))
            ? { stream: true as const }
            : {}),
          result: clean(inline(result)),
        },
      ]
    }),
  )
  // Each type brings every type it mentions, including ones it only picks from; keep those the verbs reach.
  const components = Object.fromEntries(
    Object.entries(schemas.definitions)
      .filter(([name]) => isComponent(name))
      .map(([name, schema]) => [componentName(name), clean(inline(schema as Schema))]),
  )
  const reached = new Set<string>()
  const reach = (value: unknown): void => {
    for (const [, name] of JSON.stringify(value).matchAll(/"#\/components\/schemas\/([^"]+)"/g)) {
      if (!reached.has(name!)) {
        reached.add(name!)
        reach(components[name!])
      }
    }
  }
  reach(verbs)
  return {
    // `forges` exports no `package.json`; its entry is in `dist/`.
    forges: JSON.parse(
      readFileSync(new URL("../package.json", import.meta.resolve("forges")), "utf8"),
    ).version,
    verbs,
    schemas: Object.fromEntries([...reached].sort().map((name) => [name, components[name]!])),
  }
}

function docOf(declaration: TS.ParameterDeclaration): { description?: string } {
  const description = ts
    .getJSDocParameterTags(declaration)
    .map((tag) => ts.getTextOfJSDocComment(tag.comment))
    .find(Boolean)
  return description ? { description } : {}
}

/** The type a `Promise<T>` return resolves with. */
function awaited(program: TS.Program, node: TS.TypeNode): TS.TypeNode {
  return ts.isTypeReferenceNode(node) && isLib(program, node, "Promise") && node.typeArguments
    ? node.typeArguments[0]!
    : node
}

/** `node` names the global `name` from TypeScript's lib, not a `forges` type that happens to share it. */
function isLib(program: TS.Program, node: TS.TypeReferenceNode, name: string): boolean {
  if (!ts.isIdentifier(node.typeName) || node.typeName.text !== name) {
    return false
  }
  return !!program
    .getTypeChecker()
    .getSymbolAtLocation(node.typeName)
    ?.declarations?.some((declaration) =>
      program.isSourceFileDefaultLibrary(declaration.getSourceFile()),
    )
}

class BytesType extends Base {
  getId(): string {
    return "bytes"
  }
}
class StreamType extends Base {
  getId(): string {
    return "stream"
  }
}

/**
 * Types as the wire carries them: bytes as `{ $bytes }`, a byte stream as the response itself, `AbortSignal` not at
 * all, since the proxy passes the request's own, and a `ForgeListing<T>` as the `Page<T>` the proxy answers with.
 */
class WireTypes implements SubNodeParser, SubTypeFormatter {
  chain!: ChainNodeParser
  private readonly program: TS.Program
  private readonly forges: ForgesTypes

  constructor(program: TS.Program, forges: ForgesTypes) {
    this.program = program
    this.forges = forges
  }

  supportsNode(node: TS.Node): boolean {
    return !!this.lib(node) || this.isListing(node)
  }

  createType(node: TS.Node, context: Context): BaseType {
    if (this.isListing(node)) {
      const page = new Context(node as never)
      for (const argument of (node as TS.TypeReferenceNode).typeArguments ?? []) {
        page.pushArgument(this.chain.createType(argument as never, context))
      }
      return this.chain.createType(this.forges.page as never, page)
    }
    const name = this.lib(node)
    return name === "Uint8Array"
      ? new BytesType()
      : name === "ReadableStream"
        ? new StreamType()
        : new NeverType()
  }

  supportsType(type: BaseType): boolean {
    return type instanceof BytesType || type instanceof StreamType
  }

  getDefinition(type: BaseType): Definition {
    return (type instanceof BytesType ? BYTES : STREAM) as Definition
  }

  getChildren(): BaseType[] {
    return []
  }

  private isListing(node: TS.Node): boolean {
    if (!ts.isTypeReferenceNode(node)) {
      return false
    }
    const checker = this.program.getTypeChecker()
    const symbol = checker.getSymbolAtLocation(node.typeName)
    return (
      !!symbol &&
      (symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol) ===
        this.forges.listing
    )
  }

  private lib(node: TS.Node): string | undefined {
    return ts.isTypeReferenceNode(node)
      ? ["Uint8Array", "ReadableStream", "AbortSignal"].find((name) =>
          isLib(this.program, node, name),
        )
      : undefined
  }
}

/**
 * Schemas for type nodes in `program`, collecting the named types they reference into `definitions`. Parses with the
 * chain itself: the parser `createParser()` returns would inline a root reference such as `RepoRef`.
 */
/** The `forges` types the wire maps: a listing is answered with its page. */
interface ForgesTypes {
  listing: TS.Symbol
  page: TS.Declaration
}

function schemaGenerator(program: TS.Program, forges: ForgesTypes) {
  const config = {
    ...DEFAULT_CONFIG,
    expose: "all" as const,
    topRef: false,
    jsDoc: "extended" as const,
    functions: "hide" as const,
    additionalProperties: true,
    skipTypeCheck: true,
  }
  const wire = new WireTypes(program, forges)
  let chain!: ChainNodeParser
  const parser = createParser(program as never, config, (mutable) => {
    chain = mutable as ChainNodeParser
    wire.chain = chain
    chain.addNodeParser(wire)
  })
  const formatter = createFormatter(config, (mutable) => mutable.addTypeFormatter(wire))
  return new (class extends SchemaGenerator {
    readonly definitions: Record<string, Definition> = {}
    readonly #sources = new Map<string, string>()

    /** The schema of one of `nodes`: overloads give a parameter several. */
    of(nodes: TS.TypeNode[]): Schema {
      const branches = nodes.map((node) => {
        const type = chain.createType(node as never, new Context())
        // The generator only catches a name clash within one call, and keeps the first type otherwise.
        for (const child of this.typeFormatter.getChildren(type)) {
          if (child instanceof DefinitionType) {
            const source = JSON.stringify(this.typeFormatter.getDefinition(child.getType()))
            const previous = this.#sources.get(child.getName())
            if (previous !== undefined && previous !== source) {
              throw new Error(`Two different types are named ${child.getName()}`)
            }
            this.#sources.set(child.getName(), source)
          }
        }
        this.appendRootChildDefinitions(type, this.definitions)
        return this.typeFormatter.getDefinition(type) as Schema
      })
      const distinct = [...new Map(branches.map((b) => [JSON.stringify(b), b])).values()]
      return distinct.length === 1 ? distinct[0]! : { anyOf: distinct }
    }
  })(program as never, parser, formatter, config)
}

/** OpenAPI component names allow only `[A-Za-z0-9._-]`: `Page<Repo>` becomes `PageOfRepo`. */
function componentName(name: string): string {
  return name.replace(/<(.+)>$/, "Of$1").replace(/[^\w.-]/g, "_")
}

/**
 * Draft-07 as the generator writes it, with refs pointing at OpenAPI components, `{@link}`s as code, and no `never`
 * properties: the generator keeps those when they have docs, as `signal` does.
 */
function clean(value: Schema): Schema {
  return JSON.parse(JSON.stringify(value), (key, item) => {
    if (key === "properties" && item && typeof item === "object") {
      return Object.fromEntries(
        Object.entries(item as Record<string, Schema>).filter(
          ([, property]) => JSON.stringify(property.not) !== "{}",
        ),
      )
    }
    if (key === "$ref" && typeof item === "string") {
      return `#/components/schemas/${componentName(decodeURIComponent(item.replace(/^#\/definitions\//, "")))}`
    }
    if (key === "description" && typeof item === "string") {
      return item.replace(/\{@link\s+([^\s}]+)\s*\}/g, "`$1`").replace(/ {2,}/g, " ")
    }
    return item
  })
}

if (import.meta.main) {
  const output = `${JSON.stringify(generateManifest(), null, 2)}\n`
  if (process.argv.includes("--check")) {
    if (readFileSync(target, "utf8") !== output) {
      console.error("src/manifest.json is stale; run node scripts/generate-manifest.ts")
      process.exitCode = 1
    }
  } else {
    writeFileSync(target, output)
  }
}
