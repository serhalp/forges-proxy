import { Validator } from "@cfworker/json-schema"
import { argsSchema, manifest } from "#server/utils/manifest.ts"

const validators = new Map<string, Validator>()

/** Why `args` don't fit the verb's signature, or `undefined` when they do. */
export function argsProblem(verb: string, args: unknown[]): string | undefined {
  const entry = manifest.verbs[verb]
  if (!entry) {
    return undefined
  }
  let validator = validators.get(verb)
  if (!validator) {
    validator = new Validator(
      { ...argsSchema(entry), components: { schemas: manifest.schemas } },
      "2020-12",
      false,
    )
    validators.set(verb, validator)
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
