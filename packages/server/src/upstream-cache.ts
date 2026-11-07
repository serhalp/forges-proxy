import { AsyncLocalStorage } from "node:async_hooks"
import type { FetchLike } from "forges"
import { sha256Hex } from "forges/kit"
import * as v from "valibot"

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
  /** `tags` are those of the proxy response the entry served, so that a purge by tag reaches the entry too. */
  set: (key: string, value: StoredResponse, tags?: string[]) => void | Promise<void>
}

/**
 * What the cache did for one upstream request: served it `fresh`, `revalidated` it with a 304, `fetched` it, or served
 * it `stale` because upstream was rate-limited or failing.
 */
export type UpstreamOutcome = "fresh" | "revalidated" | "fetched" | "stale"

/**
 * The upstream requests of one proxy request. Writes wait for `commit()`, which knows the response's tags, and
 * `outcomes` records what the cache did for each request.
 */
export interface UpstreamScope {
  run: <T>(fn: () => Promise<T>) => Promise<T>
  commit: (tags: string[]) => Promise<void>
  readonly outcomes: UpstreamOutcome[]
}

interface ScopeState {
  pending: Map<string, { store: UpstreamStore; entry: StoredResponse }>
  outcomes: UpstreamOutcome[]
}

const scopes = new AsyncLocalStorage<ScopeState>()

function record(outcome: UpstreamOutcome): void {
  scopes.getStore()?.outcomes.push(outcome)
}

export function upstreamScope(): UpstreamScope {
  const state: ScopeState = { pending: new Map(), outcomes: [] }
  return {
    run: (fn) => scopes.run(state, fn),
    async commit(tags) {
      const writes = [...state.pending]
      state.pending.clear()
      await Promise.all(writes.map(async ([key, { store, entry }]) => store.set(key, entry, tags)))
    },
    outcomes: state.outcomes,
  }
}

export interface UpstreamCacheOptions {
  /** @default memoryStore() */
  store?: UpstreamStore
  now?: () => number
  /** Larger bodies are passed through without being stored. @default 5 MiB */
  maxBodyBytes?: number
  /** How long past its freshness a response may stand in while upstream is rate-limited or failing. @default 1 day */
  staleIfErrorSeconds?: number
}

const CONDITIONAL = ["if-none-match", "if-modified-since", "range"]
// The body is stored decoded, so these no longer describe it.
const BODY_FRAMING = new Set(["content-encoding", "content-length", "transfer-encoding"])

/**
 * A `fetch` for forges providers that keeps GET responses and revalidates them with their `etag` or `last-modified`,
 * so that a repeat costs a `304` (free on GitHub's rate limit when authenticated) or nothing while upstream `max-age` says it's fresh.
 * The key covers every request header, so responses are never shared between credentials or `accept` variants.
 */
export interface CachingFetch extends FetchLike {
  /** Makes every stored response revalidate before it's served again, e.g. after a webhook. */
  expire: () => void
}

export function cachingFetch(fetch: FetchLike, options: UpstreamCacheOptions = {}): CachingFetch {
  const store = options.store ?? memoryStore()
  const now = options.now ?? Date.now
  const maxBodyBytes = options.maxBodyBytes ?? 5 * 1024 * 1024
  const staleIfError = (options.staleIfErrorSeconds ?? 24 * 60 * 60) * 1000
  // A write may change anything its credential reads, so later reads revalidate instead of trusting `max-age`.
  const lastWrite = new Map<string, number>()
  let expiredAt = -Infinity
  const get = (key: string) => scopes.getStore()?.pending.get(key)?.entry ?? store.get(key)
  const set = async (key: string, entry: StoredResponse) => {
    const scope = scopes.getStore()
    if (scope) {
      scope.pending.set(key, { store, entry })
    } else {
      await store.set(key, entry)
    }
  }

  const cached: FetchLike = async (input, init = {}) => {
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
    const stored = await get(key)
    if (
      stored &&
      stored.maxAge > 0 &&
      now() - stored.storedAt < stored.maxAge * 1000 &&
      stored.storedAt > Math.max(expiredAt, lastWrite.get(credential) ?? -Infinity)
    ) {
      record("fresh")
      return toResponse(stored, { withoutRateLimit: true })
    }

    const validated = stored ? addValidators(headers, stored) : false
    const usable = (entry: StoredResponse | undefined): entry is StoredResponse =>
      !!entry && now() - entry.storedAt < entry.maxAge * 1000 + staleIfError
    let response: Response
    try {
      response = await fetch(input, { ...init, headers })
    } catch (error) {
      if (!usable(stored) || init.signal?.aborted) {
        throw error
      }
      record("stale")
      return toResponse(stored, { withoutRateLimit: true })
    }
    // An old answer beats none, on a public instance especially, where the token's budget is shared.
    if (usable(stored) && isUnavailable(response)) {
      await response.body?.cancel()
      record("stale")
      return toResponse(stored, { withoutRateLimit: true })
    }
    if (stored && validated && response.status === 304) {
      await response.body?.cancel()
      const refreshed: StoredResponse = {
        ...stored,
        headers: mergeHeaders(stored.headers, response.headers),
        storedAt: now(),
        maxAge: maxAgeOf(response.headers) ?? stored.maxAge,
      }
      await set(key, refreshed)
      record("revalidated")
      return toResponse(refreshed)
    }
    record("fetched")
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
      await set(key, entry)
    }
    return toResponse(entry)
  }
  return Object.assign(cached, {
    expire: () => {
      expiredAt = now()
    },
  })
}

/** Rate-limited (GitHub says so with a 403) or failing. */
function isUnavailable(response: Response): boolean {
  return (
    response.status >= 500 ||
    response.status === 429 ||
    (response.status === 403 &&
      (response.headers.get("x-ratelimit-remaining") === "0" ||
        response.headers.has("retry-after")))
  )
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
export function memoryStore(maxBytes = 64 * 1024 * 1024): {
  get: (key: string) => StoredResponse | undefined
  set: (key: string, value: StoredResponse) => void
} {
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

// Long enough to keep validators around well past upstream `max-age`.
const RETENTION_SECONDS = 24 * 60 * 60
const ENTRY_URL = "https://upstream.forges-proxy.invalid/"

const StoredMeta = v.object({
  status: v.number(),
  headers: v.array(v.tuple([v.string(), v.string()])),
  storedAt: v.number(),
  maxAge: v.number(),
})

/**
 * A store on the Cache API (`caches`), where the platform has one: shared by every instance in a region, and purged
 * along with the CDN by the proxy response's cache tags (`Cache-Tag`, unless `tagHeaders` says otherwise). The entry's
 * own status, headers and timestamps travel in the body, since the platform reads the stored response's headers as its
 * own instructions.
 */
export function cacheApiStore(
  open: () => Promise<Cache>,
  options: { tagHeaders?: (tags: string[]) => Record<string, string> } = {},
): UpstreamStore {
  const tagHeaders = options.tagHeaders ?? ((tags) => ({ "cache-tag": tags.join(",") }))
  const encoder = new TextEncoder()
  return {
    async get(key) {
      const response = await (await open()).match(ENTRY_URL + key)
      if (!response) {
        return undefined
      }
      const bytes = new Uint8Array(await response.arrayBuffer())
      const length = new DataView(bytes.buffer, bytes.byteOffset).getUint32(0)
      const meta = v.safeParse(
        StoredMeta,
        JSON.parse(new TextDecoder().decode(bytes.subarray(4, 4 + length))),
      )
      // An entry from an older layout is a miss.
      return meta.success ? { ...meta.output, body: bytes.slice(4 + length) } : undefined
    },
    async set(key, { body, ...meta }, tags = []) {
      const json = encoder.encode(JSON.stringify(meta))
      const bytes = new Uint8Array(4 + json.byteLength + body.byteLength)
      new DataView(bytes.buffer).setUint32(0, json.byteLength)
      bytes.set(json, 4)
      bytes.set(body, 4 + json.byteLength)
      const headers: Record<string, string> = {
        "content-type": "application/octet-stream",
        "cache-control": `public, max-age=${RETENTION_SECONDS}`,
        ...(tags.length ? tagHeaders(tags) : {}),
      }
      await (await open()).put(ENTRY_URL + key, new Response(bytes, { headers }))
    },
  }
}
