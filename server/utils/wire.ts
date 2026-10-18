import { DATE_FIELDS } from "forges"
import { toBase64 } from "forges/kit"

// `DATE_FIELDS` only covers output models; these are the `Date` fields of input options.
const INPUT_DATE_FIELDS = new Set(["since", "until", "createdAfter", "before"])

/** Revives ISO strings into `Date`s in call arguments, for every output and input date field. */
export function reviveArgs(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(reviveArgs)
  }
  if (!value || typeof value !== "object") {
    return value
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
 * JSON for a verb's result. Byte content (`FileContent` with `encoding: 'binary'`) becomes base64. `raw` forge
 * payloads are dropped unless asked for, since they are large and rarely needed.
 */
export function serialise(value: unknown, options: { raw: boolean }): string {
  return JSON.stringify(value, (key, item) => {
    if (key === "raw" && !options.raw) {
      return undefined
    }
    return item instanceof Uint8Array ? toBase64(item) : item
  })
}
