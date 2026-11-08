import { fromBase64, toBase64 } from "forges/kit"

/**
 * Bytes on the wire, both ways. A tagged object rather than a bare base64 string, since a string is text where a field
 * takes either (`FileChange.content`).
 */
function isBytes(value: object): value is { $bytes: string } {
  return Object.keys(value).length === 1 && "$bytes" in value && typeof value.$bytes === "string"
}

/** A `JSON.stringify` replacer that sends bytes as `{ "$bytes": "<base64>" }`. */
export function encodeBytes(_key: string, value: unknown): unknown {
  return value instanceof Uint8Array ? { $bytes: toBase64(value) } : value
}

/** Turns every `{ "$bytes": "<base64>" }` in parsed JSON back into bytes. */
export function decodeBytes(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(decodeBytes)
  }
  if (!value || typeof value !== "object" || value instanceof Date) {
    return value
  }
  if (isBytes(value)) {
    return fromBase64(value.$bytes)
  }
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, decodeBytes(item)]))
}
