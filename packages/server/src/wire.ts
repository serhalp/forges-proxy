import { encode } from "forges/wire"

/**
 * JSON for a verb's result. `raw` forge payloads are dropped unless asked for, since they are large and rarely needed.
 */
export function serialise(value: unknown, options: { raw: boolean }): string {
  return JSON.stringify(encode(value), (key, item) =>
    key === "raw" && !options.raw ? undefined : item,
  )
}
