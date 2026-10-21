import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { github } from "forges"
import type { StoredResponse, UpstreamStore } from "#server/utils/upstream-cache.ts"
import {
  cacheApiStore,
  cachingFetch,
  memoryStore,
  upstreamScope,
} from "#server/utils/upstream-cache.ts"

interface Sent {
  url: string
  method: string
  headers: Headers
}

/** A forge that answers `If-None-Match` for its current `etag`, and records every request. */
function upstream(
  options: {
    cacheControl?: string
    contentType?: string
    status?: number
    body?: object
    etag?: string | null
  } = {},
) {
  const sent: Sent[] = []
  let version = 1
  let remaining = 5000
  const fetch = async (url: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers)
    sent.push({ url, method: init.method ?? "GET", headers })
    const etag = options.etag === null ? undefined : (options.etag ?? `"v${version}"`)
    const common: Record<string, string> = {
      "cache-control": options.cacheControl ?? "private, max-age=60",
      "x-ratelimit-remaining": String(remaining--),
      ...(etag ? { etag } : {}),
    }
    if (etag && headers.get("if-none-match") === etag) {
      return new Response(null, { status: 304, headers: common })
    }
    return new Response(JSON.stringify(options.body ?? { version, url }), {
      status: options.status ?? 200,
      headers: {
        ...common,
        "content-type": options.contentType ?? "application/json; charset=utf-8",
      },
    })
  }
  return { fetch, sent, bump: () => version++ }
}

function clock(start = 1_000_000) {
  let time = start
  return { now: () => time, advance: (seconds: number) => (time += seconds * 1000) }
}

const url = "https://api.github.com/repos/acme/widgets"
const auth = (token: string) => ({ headers: { authorization: `Bearer ${token}` } })

describe("cachingFetch", () => {
  it("serves a fresh response without a request, and without its stale rate limit", async () => {
    const forge = upstream()
    const time = clock()
    const fetch = cachingFetch(forge.fetch, { now: time.now })
    const first = await fetch(url, auth("a"))
    assert.equal(first.headers.get("x-ratelimit-remaining"), "5000")
    time.advance(59)
    const second = await fetch(url, auth("a"))
    assert.equal(forge.sent.length, 1)
    assert.equal(second.status, 200)
    assert.deepEqual(await second.json(), { version: 1, url })
    assert.equal(second.headers.get("x-ratelimit-remaining"), null)
    assert.equal(second.headers.get("etag"), '"v1"')
  })

  it("revalidates a stale response and turns the 304 into the stored body", async () => {
    const forge = upstream()
    const time = clock()
    const fetch = cachingFetch(forge.fetch, { now: time.now })
    await fetch(url, auth("a"))
    time.advance(61)
    const response = await fetch(url, auth("a"))
    assert.equal(forge.sent[1]!.headers.get("if-none-match"), '"v1"')
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { version: 1, url })
    assert.equal(response.headers.get("x-ratelimit-remaining"), "4999")
    // Revalidation restarts the freshness window.
    time.advance(30)
    await fetch(url, auth("a"))
    assert.equal(forge.sent.length, 2)
  })

  it("replaces the stored response when the forge has a new one", async () => {
    const forge = upstream()
    const time = clock()
    const fetch = cachingFetch(forge.fetch, { now: time.now })
    await fetch(url, auth("a"))
    forge.bump()
    time.advance(61)
    assert.deepEqual(await (await fetch(url, auth("a"))).json(), { version: 2, url })
    time.advance(1)
    assert.deepEqual(await (await fetch(url, auth("a"))).json(), { version: 2, url })
    assert.equal(forge.sent.length, 2)
  })

  it("never shares a response between credentials or request headers", async () => {
    const forge = upstream()
    const fetch = cachingFetch(forge.fetch)
    await fetch(url, auth("a"))
    await fetch(url, auth("b"))
    await fetch(url, {
      headers: { authorization: "Bearer a", accept: "application/vnd.github.raw" },
    })
    assert.equal(forge.sent.length, 3)
    assert.equal(forge.sent[1]!.headers.get("if-none-match"), null)
  })

  it("passes the caller's own conditional request through untouched", async () => {
    const forge = upstream()
    const fetch = cachingFetch(forge.fetch)
    await fetch(url, auth("a"))
    const response = await fetch(url, {
      headers: { authorization: "Bearer a", "if-none-match": '"v1"' },
    })
    assert.equal(response.status, 304)
    assert.equal(forge.sent.length, 2)
  })

  it("revalidates a credential's reads after it writes, and only that credential's", async () => {
    const forge = upstream()
    const time = clock()
    const fetch = cachingFetch(forge.fetch, { now: time.now })
    await fetch(url, auth("a"))
    await fetch(url, auth("b"))
    time.advance(1)
    await fetch(`${url}/issues/1/comments`, { method: "POST", ...auth("a") })
    time.advance(1)
    await fetch(url, auth("a"))
    await fetch(url, auth("b"))
    assert.deepEqual(
      forge.sent.map(({ method, headers }) => [
        method,
        headers.get("authorization"),
        headers.get("if-none-match"),
      ]),
      [
        ["GET", "Bearer a", null],
        ["GET", "Bearer b", null],
        ["POST", "Bearer a", null],
        ["GET", "Bearer a", '"v1"'],
      ],
    )
  })

  it("revalidates everything it holds once expired", async () => {
    const forge = upstream()
    const time = clock()
    const fetch = cachingFetch(forge.fetch, { now: time.now })
    await fetch(url, auth("a"))
    await fetch(url, auth("b"))
    time.advance(1)
    fetch.expire()
    time.advance(1)
    await fetch(url, auth("a"))
    await fetch(url, auth("b"))
    assert.deepEqual(
      forge.sent.map(({ headers }) => headers.get("if-none-match")),
      [null, null, '"v1"', '"v1"'],
    )
  })

  it("does not store what it can't reuse", async () => {
    for (const options of [
      { cacheControl: "no-store" },
      { contentType: "text/plain" },
      { status: 404 },
      { etag: null, cacheControl: "no-cache" },
    ]) {
      const forge = upstream(options)
      const fetch = cachingFetch(forge.fetch)
      await fetch(url, auth("a"))
      await fetch(url, auth("a"))
      assert.equal(forge.sent.length, 2, JSON.stringify(options))
      assert.equal(forge.sent[1]!.headers.get("if-none-match"), null, JSON.stringify(options))
    }
  })

  it("passes a body larger than the limit through without storing it", async () => {
    const forge = upstream()
    const fetch = cachingFetch(forge.fetch, { maxBodyBytes: 10 })
    assert.equal(((await (await fetch(url, auth("a"))).json()) as { version: number }).version, 1)
    await fetch(url, auth("a"))
    assert.equal(forge.sent.length, 2)
  })

  it("works behind a real provider", async () => {
    const forge = upstream({
      body: {
        id: 1,
        full_name: "acme/widgets",
        name: "widgets",
        owner: { login: "acme" },
        default_branch: "main",
      },
    })
    const time = clock()
    const provider = github({
      auth: { type: "token", token: "t" },
      fetch: cachingFetch(forge.fetch, { now: time.now }),
    }).create()
    const repo = { forge: "github", instance: "github.com", owner: "acme", name: "widgets" }
    await provider.repos.get(repo)
    time.advance(61)
    await provider.repos.get(repo)
    assert.equal(forge.sent.length, 2)
    assert.equal(forge.sent[1]!.headers.get("if-none-match"), '"v1"')
    // The provider read the 304 as the full response, and saw the fresh budget.
    assert.equal(provider.rateLimits()[0]?.remaining, 4999)
  })
})

describe("memoryStore", () => {
  it("evicts the least recently used entries beyond its size", () => {
    const store = memoryStore(250)
    const entry = { status: 200, headers: [], body: new Uint8Array(100), storedAt: 0, maxAge: 0 }
    store.set("a", entry)
    store.set("b", entry)
    store.get("a")
    store.set("c", entry)
    assert.ok(store.get("a"))
    assert.equal(store.get("b"), undefined)
    assert.ok(store.get("c"))
  })
})

describe("upstreamScope", () => {
  /** A memory store that also records the tags of each write. */
  function taggedStore() {
    const memory = memoryStore()
    const writes: Array<{ key: string; tags?: string[] }> = []
    const store: UpstreamStore = {
      get: (key) => memory.get(key),
      set: (key, value, tags) => {
        writes.push({ key, tags })
        return memory.set(key, value)
      },
    }
    return { store, writes }
  }

  it("holds writes until commit, which tags them", async () => {
    const forge = upstream()
    const { store, writes } = taggedStore()
    const fetch = cachingFetch(forge.fetch, { store })
    const scope = upstreamScope()
    await scope.run(async () => {
      await fetch(url)
      assert.equal(writes.length, 0)
      // Within the scope, the pending entry already answers.
      await fetch(url)
    })
    assert.equal(forge.sent.length, 1)
    await scope.commit(["github:github.com/acme/widgets"])
    assert.deepEqual(
      writes.map(({ tags }) => tags),
      [["github:github.com/acme/widgets"]],
    )
    assert.deepEqual(scope.outcomes, ["fetched", "fresh"])
  })

  it("records revalidations", async () => {
    const forge = upstream()
    const time = clock()
    const fetch = cachingFetch(forge.fetch, { now: time.now })
    await fetch(url)
    time.advance(61)
    const scope = upstreamScope()
    await scope.run(() => fetch(url))
    assert.deepEqual(scope.outcomes, ["revalidated"])
  })

  it("writes straight through outside a scope", async () => {
    const { store, writes } = taggedStore()
    await cachingFetch(upstream().fetch, { store })(url)
    assert.deepEqual(
      writes.map(({ tags }) => tags),
      [undefined],
    )
  })
})

/** Enough of a `Cache` for the store: responses by URL. */
function stubCache() {
  const responses = new Map<string, Response>()
  const cache = {
    match: async (url: string) => responses.get(url)?.clone(),
    put: async (url: string, response: Response) => void responses.set(url, response),
  } as unknown as Cache
  return { cache, responses }
}

describe("cacheApiStore", () => {
  const entry: StoredResponse = {
    status: 200,
    headers: [
      ["etag", '"v1"'],
      ["cache-control", "private, max-age=60"],
    ],
    body: new TextEncoder().encode('{"ok":true}'),
    storedAt: 1234,
    maxAge: 60,
  }

  it("round-trips an entry", async () => {
    const { cache } = stubCache()
    const store = cacheApiStore(async () => cache)
    await store.set("key", entry, ["a", "b"])
    assert.deepEqual(await store.get("key"), entry)
    assert.equal(await store.get("other"), undefined)
  })

  it("stores what the platform will keep, tagged for purges", async () => {
    const { cache, responses } = stubCache()
    await cacheApiStore(async () => cache).set("key", entry, ["a", "b"])
    const [stored] = [...responses.values()]
    // The upstream `private` would make the platform refuse it.
    assert.match(stored!.headers.get("cache-control")!, /^public, max-age=\d+$/)
    assert.equal(stored!.headers.get("netlify-cache-tag"), "a,b")
    assert.equal(stored!.headers.has("cache-tag"), false)
  })

  it("backs cachingFetch", async () => {
    const forge = upstream()
    const { cache } = stubCache()
    const fetch = cachingFetch(forge.fetch, { store: cacheApiStore(async () => cache) })
    await fetch(url)
    const response = await fetch(url)
    assert.equal(forge.sent.length, 1)
    assert.deepEqual(await response.json(), { version: 1, url })
  })
})

describe("stale if error", () => {
  /** Answers once, then with whatever `fail` says. */
  function flaky() {
    let fail: (() => Response | Promise<Response>) | undefined
    const fetch = async () =>
      fail
        ? fail()
        : new Response('{"ok":true}', {
            headers: {
              "content-type": "application/json",
              "cache-control": "max-age=60",
              etag: '"v1"',
              "x-ratelimit-remaining": "10",
            },
          })
    return { fetch, failWith: (next: () => Response | Promise<Response>) => (fail = next) }
  }

  async function primed(next: () => Response | Promise<Response>, staleFor = 61) {
    const forge = flaky()
    const time = clock()
    const fetch = cachingFetch(forge.fetch, { now: time.now })
    await fetch(url)
    time.advance(staleFor)
    forge.failWith(next)
    return fetch
  }

  it("serves the stored response while upstream is failing or rate-limited", async () => {
    for (const failure of [
      () => new Response(null, { status: 503 }),
      () => new Response(null, { status: 429 }),
      () => new Response(null, { status: 403, headers: { "x-ratelimit-remaining": "0" } }),
      () => new Response(null, { status: 403, headers: { "retry-after": "60" } }),
      () => Promise.reject(new TypeError("fetch failed")),
    ]) {
      const fetch = await primed(failure)
      const scope = upstreamScope()
      const response = await scope.run(() => fetch(url))
      assert.equal(response.status, 200)
      assert.deepEqual(await response.json(), { ok: true })
      assert.equal(response.headers.get("x-ratelimit-remaining"), null)
      assert.deepEqual(scope.outcomes, ["stale"])
    }
  })

  it("passes on a plain 403, which is an answer", async () => {
    const fetch = await primed(() => new Response(null, { status: 403 }))
    assert.equal((await fetch(url)).status, 403)
  })

  it("gives up past the window, or when the caller aborted", async () => {
    const late = await primed(() => new Response(null, { status: 503 }), 2 * 24 * 60 * 60)
    assert.equal((await late(url)).status, 503)
    const controller = new AbortController()
    controller.abort()
    const aborted = await primed(() => Promise.reject(controller.signal.reason))
    await assert.rejects(aborted(url, { signal: controller.signal }), { name: "AbortError" })
  })
})
