import type { FetchLike } from "forges"
import { sha256Hex } from "forges/kit"

/** An upstream response as the cache keeps it. */
export interface StoredResponse {
  status: number
  headers: Array<[string, string]>
  body: Uint8Array
  /** Epoch milliseconds when the response was received or last revalidated. */
  storedAt: number
  /** Seconds the response stays fresh, from upstream `cache-control`. */
  maxAge: number
}

export interface UpstreamStore {
  get: (key: string) => StoredResponse | undefined | Promise<StoredResponse | undefined>
  set: (key: string, value: StoredResponse) => void | Promise<void>
}

export interface UpstreamCacheOptions {
  /** @default memoryStore() */
  store?: UpstreamStore
  now?: () => number
  /** Larger bodies are passed through without being stored. @default 5 MiB */
  maxBodyBytes?: number
}

const CONDITIONAL = ["if-none-match", "if-modified-since", "range"]
// The body is stored decoded, so these no longer describe it.
const BODY_FRAMING = new Set(["content-encoding", "content-length", "transfer-encoding"])

/**
 * A `fetch` for forges providers that keeps GET responses and revalidates them with their `etag` or `last-modified`,
 * so that a repeat costs a `304` (free on GitHub's rate limit) or nothing while upstream `max-age` says it's fresh.
 * The key covers every request header, so responses are never shared between credentials or `accept` variants.
 */
export function cachingFetch(fetch: FetchLike, options: UpstreamCacheOptions = {}): FetchLike {
  const store = options.store ?? memoryStore()
  const now = options.now ?? Date.now
  const maxBodyBytes = options.maxBodyBytes ?? 5 * 1024 * 1024
  // A write may change anything its credential reads, so later reads revalidate instead of trusting `max-age`.
  const lastWrite = new Map<string, number>()

  return async (input, init = {}) => {
    const headers = new Headers(init.headers)
    const method = (init.method ?? "GET").toUpperCase()
    const credential = await sha256Hex(headers.get("authorization") ?? "")
    if (method !== "GET") {
      const response = await fetch(input, init)
      lastWrite.set(credential, now())
      return response
    }
    // The caller is revalidating or ranging itself, and expects the raw answer.
    if (CONDITIONAL.some((name) => headers.has(name))) {
      return fetch(input, init)
    }

    const key = await sha256Hex(JSON.stringify([input, [...headers]]))
    const stored = await store.get(key)
    if (
      stored &&
      stored.maxAge > 0 &&
      now() - stored.storedAt < stored.maxAge * 1000 &&
      stored.storedAt > (lastWrite.get(credential) ?? -Infinity)
    ) {
      return toResponse(stored, { withoutRateLimit: true })
    }

    const validated = stored ? addValidators(headers, stored) : false
    const response = await fetch(input, { ...init, headers })
    if (stored && validated && response.status === 304) {
      await response.body?.cancel()
      const refreshed: StoredResponse = {
        ...stored,
        headers: mergeHeaders(stored.headers, response.headers),
        storedAt: now(),
        maxAge: maxAgeOf(response.headers) ?? stored.maxAge,
      }
      await store.set(key, refreshed)
      return toResponse(refreshed)
    }
    if (!isStorable(response, maxBodyBytes)) {
      return response
    }
    const body = new Uint8Array(await response.arrayBuffer())
    const entry: StoredResponse = {
      status: response.status,
      headers: [...response.headers].filter(([name]) => !BODY_FRAMING.has(name)),
      body,
      storedAt: now(),
      maxAge: maxAgeOf(response.headers) ?? 0,
    }
    if (body.byteLength <= maxBodyBytes) {
      await store.set(key, entry)
    }
    return toResponse(entry)
  }
}

function addValidators(headers: Headers, stored: StoredResponse): boolean {
  const stale = new Headers(stored.headers)
  const etag = stale.get("etag")
  const lastModified = stale.get("last-modified")
  if (etag) {
    headers.set("if-none-match", etag)
  }
  if (lastModified) {
    headers.set("if-modified-since", lastModified)
  }
  return !!(etag || lastModified)
}

/** Only complete JSON API responses: logs, raw files and assets keep streaming. */
function isStorable(response: Response, maxBodyBytes: number): boolean {
  const cacheControl = response.headers.get("cache-control") ?? ""
  const length = Number(response.headers.get("content-length") ?? 0)
  return (
    response.status === 200 &&
    !/\bno-store\b/i.test(cacheControl) &&
    /\bjson\b/i.test(response.headers.get("content-type") ?? "") &&
    length <= maxBodyBytes &&
    (response.headers.has("etag") ||
      response.headers.has("last-modified") ||
      (maxAgeOf(response.headers) ?? 0) > 0)
  )
}

function maxAgeOf(headers: Headers): number | undefined {
  const cacheControl = headers.get("cache-control")
  if (!cacheControl) {
    return undefined
  }
  if (/\bno-cache\b/i.test(cacheControl)) {
    return 0
  }
  const maxAge = /\bmax-age=(\d+)/i.exec(cacheControl)?.[1]
  return maxAge === undefined
    ? undefined
    : Math.max(0, Number(maxAge) - Number(headers.get("age") ?? 0))
}

/** The stored headers, updated with those of a `304`, as RFC 9111 has a cache do. */
function mergeHeaders(stored: Array<[string, string]>, update: Headers): Array<[string, string]> {
  const merged = new Headers(stored)
  for (const [name, value] of update) {
    if (!BODY_FRAMING.has(name)) {
      merged.set(name, value)
    }
  }
  return [...merged]
}

function toResponse(entry: StoredResponse, options: { withoutRateLimit?: boolean } = {}): Response {
  // A budget read from a stored response would be stale; no budget is better than a wrong one.
  const headers = options.withoutRateLimit
    ? entry.headers.filter(([name]) => !/ratelimit|^retry-after$/.test(name))
    : entry.headers
  return new Response(entry.body.slice(), { status: entry.status, headers })
}

/** An in-memory store that evicts the least recently used entries beyond `maxBytes`. */
export function memoryStore(maxBytes = 64 * 1024 * 1024): UpstreamStore {
  const entries = new Map<string, StoredResponse>()
  let bytes = 0
  const sizeOf = (entry: StoredResponse) =>
    entry.body.byteLength + JSON.stringify(entry.headers).length
  return {
    get(key) {
      const entry = entries.get(key)
      if (entry) {
        entries.delete(key)
        entries.set(key, entry)
      }
      return entry
    },
    set(key, value) {
      const previous = entries.get(key)
      if (previous) {
        bytes -= sizeOf(previous)
        entries.delete(key)
      }
      entries.set(key, value)
      bytes += sizeOf(value)
      for (const [oldest, entry] of entries) {
        if (bytes <= maxBytes) {
          break
        }
        entries.delete(oldest)
        bytes -= sizeOf(entry)
      }
    },
  }
}
