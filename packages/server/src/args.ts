import { Validator } from "@cfworker/json-schema"
import type { H3Event } from "h3"
import { getQuery, readBody } from "h3"
import { decode } from "forges/wire"
import type { VerbSignature } from "./manifest.ts"
import { argsSchema, manifest } from "./manifest.ts"

const validators = new Map<string, Validator>()

/**
 * The call's arguments, revived, from `?args=` on reads and `{ args }` on writes; or why they can't be passed to the
 * verb.
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
  // JSON has no `undefined`, so a skipped optional argument arrives as `null`.
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
  // A repeated `?args=` arrives as an array, which is no JSON.
  if (typeof value !== "string") {
    return undefined
  }
  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}

/** Why `args` don't fit the verb's signature, or `undefined` when they do. */
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
  // The deepest error names the field; those above it, and `$ref`s, only say that their branch failed.
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
 * A ref anywhere in `value` for another forge or instance. The provider would send it to its own host anyway, and the
 * response would be tagged for a forge whose webhooks never reach this one.
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

// Anything else in the body, or a missing body, is left for the `args` check to name.
function bodyArgs(body: unknown): unknown {
  return (typeof body === "object" && body !== null && "args" in body ? body.args : undefined) ?? []
}
