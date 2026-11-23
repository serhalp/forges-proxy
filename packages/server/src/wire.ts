import { encode } from "forges/wire"

/**
 * Serializes a verb result to JSON using `forges/wire` encoding, stripping `raw` upstream payloads
 * unless `options.raw` is true.
 */
export function serialize(value: unknown, options: { raw: boolean }): string {
  return JSON.stringify(encode(value), (key, item) =>
    key === "raw" && !options.raw ? undefined : item,
  )
}
