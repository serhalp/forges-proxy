import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { github } from "forges"
import { cachingFetch, memoryStore } from "#server/utils/upstream-cache.ts"

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
