import { Validator } from "@cfworker/json-schema"
import type { H3Event } from "h3"
import { getQuery, readBody } from "h3"
import { decode } from "forges/wire"
import type { VerbSignature } from "./manifest.ts"
import { argsSchema, manifest } from "./manifest.ts"

const validators = new Map<string, Validator>()

/**
 * Parses, validates, and wire-decodes positional arguments from `?args=` (reads) or `{ args }`
 * (writes). Returns `{ problem }` on validation failure.
 */
export async function readArgs(
  event: H3Event,
  name: string,
  verb: VerbSignature,
  origin: { forge: string; instance: string },
): Promise<{ args: unknown[] } | { problem: string }> {
  const wire = verb.write ? bodyArgs(await readBody(event)) : parseArgs(getQuery(event).args)
  if (!Array.isArray(wire)) {
    return { problem: "`args` must be a JSON array" }
  }
  const problem = argsProblem(name, verb, wire) ?? foreignRef(wire, origin)
  if (problem) {
    return { problem }
  }
  // `null` represents an omitted optional positional argument in JSON.
  try {
    const args = decode(wire.map((arg) => arg ?? undefined))
    if (!Array.isArray(args)) {
      return { problem: "`args` must be a JSON array" }
    }
    return { args }
  } catch (error) {
    return { problem: error instanceof Error ? error.message : "Invalid wire value" }
  }
}

function parseArgs(value: unknown): unknown {
  if (value === undefined) {
    return []
  }
  // Reject repeated `?args=` parameters, which h3 parses as an array of strings.
  if (typeof value !== "string") {
    return undefined
  }
  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}

/** Validates `args` against the verb's JSON Schema and returns a human-readable error message on failure. */
function argsProblem(name: string, verb: VerbSignature, args: unknown[]): string | undefined {
  let validator = validators.get(name)
  if (!validator) {
    validator = new Validator(
      { ...argsSchema(verb), components: { schemas: manifest.schemas } },
      "2020-12",
      false,
    )
    validators.set(name, validator)
  }
  const { valid, errors } = validator.validate(args)
  if (valid) {
    return undefined
  }
  // Report the most specific leaf error rather than parent `$ref` or container errors.
  const deepest = errors
    .filter((error) => error.keyword !== "$ref")
    .reduce((best, error) =>
      error.instanceLocation.split("/").length > best.instanceLocation.split("/").length
        ? error
        : best,
    )
  return `${deepest.instanceLocation.replace(/^#/, "args")}: ${deepest.error}`
}

/**
 * Checks whether `value` contains a ref targeting a different forge or instance than the route's
 * `:forge/:instance` parameters, preventing cross-provider calls and mis-tagged cache entries.
 */
function foreignRef(
  value: unknown,
  origin: { forge: string; instance: string },
  path = "args",
): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined
  }
  const { forge, instance } = value as { forge?: unknown; instance?: unknown }
  if (
    typeof forge === "string" &&
    (forge !== origin.forge || (typeof instance === "string" && instance !== origin.instance))
  ) {
    return `${path} names ${forge} on ${String(instance)}, not ${origin.forge} on ${origin.instance}`
  }
  for (const [key, item] of Object.entries(value)) {
    const problem =
      key === "raw" || key === "payload" ? undefined : foreignRef(item, origin, `${path}/${key}`)
    if (problem) {
      return problem
    }
  }
  return undefined
}

function bodyArgs(body: unknown): unknown {
  return (typeof body === "object" && body !== null && "args" in body ? body.args : undefined) ?? []
}
