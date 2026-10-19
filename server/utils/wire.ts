import { DATE_FIELDS } from "forges"
import { fromBase64, toBase64 } from "forges/kit"

// `DATE_FIELDS` only covers output models; these are the `Date` fields of input options.
export const INPUT_DATE_FIELDS: ReadonlySet<string> = new Set([
  "since",
  "until",
  "createdAfter",
  "before",
])

/** Revives ISO strings into `Date`s in call arguments, for every output and input date field, and decodes bytes. */
export function reviveArgs(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(reviveArgs)
  }
  if (!value || typeof value !== "object") {
    return value
  }
  if (isBytes(value)) {
    return fromBase64(value.$bytes)
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      (DATE_FIELDS.has(key) || INPUT_DATE_FIELDS.has(key)) &&
      typeof item === "string" &&
      !Number.isNaN(Date.parse(item))
        ? new Date(item)
        : key === "raw" || key === "payload"
          ? item
          : reviveArgs(item),
    ]),
  )
}

/**
 * JSON for a verb's result, with bytes as `{ "$bytes": "<base64>" }`. `raw` forge payloads are dropped unless asked
 * for, since they are large and rarely needed.
 */
export function serialise(value: unknown, options: { raw: boolean }): string {
  return JSON.stringify(value, (key, item) => {
    if (key === "raw" && !options.raw) {
      return undefined
    }
    return item instanceof Uint8Array ? { $bytes: toBase64(item) } : item
  })
}

/**
 * Bytes on the wire, both ways. A tagged object rather than a bare base64 string, since a string is text where a field
 * takes either (`FileChange.content`).
 */
export function isBytes(value: object): value is { $bytes: string } {
  const keys = Object.keys(value)
  return (
    keys.length === 1 &&
    keys[0] === "$bytes" &&
    typeof (value as { $bytes: unknown }).$bytes === "string"
  )
}
