import { Validator } from "@cfworker/json-schema"
import type { H3Event } from "h3"
import { getQuery, readBody } from "h3"
import type { ManifestVerb } from "#src/manifest.ts"
import { argsSchema, manifest } from "#src/manifest.ts"
import { reviveArgs } from "#src/wire.ts"

const validators = new Map<string, Validator>()

/**
 * The call's arguments, revived, from `?args=` on reads and `{ args }` on writes; or why they can't be passed to the
 * verb.
 */
export async function readArgs(
  event: H3Event,
  name: string,
  verb: ManifestVerb,
  origin: { forge: string; instance: string },
): Promise<{ args: unknown[] } | { problem: string }> {
  const wire = verb.write
    ? ((await readBody<{ args?: unknown }>(event))?.args ?? [])
    : parseArgs(getQuery(event).args)
  if (!Array.isArray(wire)) {
    return { problem: "`args` must be a JSON array" }
  }
  const problem = argsProblem(name, verb, wire) ?? foreignRef(wire, origin)
  if (problem) {
    return { problem }
  }
  // JSON has no `undefined`, so a skipped optional argument arrives as `null`.
  return { args: reviveArgs(wire.map((arg) => arg ?? undefined)) as unknown[] }
}

function parseArgs(value: unknown): unknown {
  if (value === undefined) {
    return []
  }
  try {
    return JSON.parse(String(value))
  } catch {
    return undefined
  }
}

/** Why `args` don't fit the verb's signature, or `undefined` when they do. */
function argsProblem(name: string, verb: ManifestVerb, args: unknown[]): string | undefined {
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
