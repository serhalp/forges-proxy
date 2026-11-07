import { DATE_FIELDS } from "forges"
import { fromBase64, toBase64 } from "forges/kit"

/**
 * Bytes travel as `{ "$bytes": "<base64>" }` both ways: a bare string is text where a field takes either
 * (`FileChange.content`). `@forges-proxy/client` has its own copy; its tests round-trip bytes through this one.
 */
function isBytes(value: object): value is { $bytes: string } {
  const keys = Object.keys(value)
  return keys.length === 1 && typeof (value as { $bytes?: unknown }).$bytes === "string"
}

function encodeBytes(_key: string, value: unknown): unknown {
  return value instanceof Uint8Array ? { $bytes: toBase64(value) } : value
}

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
  return JSON.stringify(value, (key, item) =>
    key === "raw" && !options.raw ? undefined : encodeBytes(key, item),
  )
}
