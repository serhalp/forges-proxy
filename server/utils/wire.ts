import { DATE_FIELDS } from "forges"
import { fromBase64 } from "forges/kit"
import { encodeBytes, isBytes } from "#shared/wire.ts"

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
