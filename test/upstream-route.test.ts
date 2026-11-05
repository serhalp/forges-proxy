import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { createForges, github } from "forges"
import { cachingFetch, memoryStore } from "#server/utils/upstream-cache.ts"
import type { UpstreamStore } from "#server/utils/upstream-cache.ts"
import { createProxy, env } from "./support/proxy.ts"

const memory = memoryStore()
const tagged: string[][] = []
const store: UpstreamStore = {
  get: (key) => memory.get(key),
  set: (key, value, tags) => {
    tagged.push(tags ?? [])
    return memory.set(key, value)
  },
}
const body = JSON.stringify({
  id: 42,
  full_name: "acme/widgets",
  name: "widgets",
  owner: { login: "acme" },
  default_branch: "main",
})
const forge = async () =>
  new Response(body, {
    headers: {
      "content-type": "application/json",
      "cache-control": "public, max-age=60",
      etag: '"v1"',
    },
  })
const app = await createProxy(createForges([github({ fetch: cachingFetch(forge, { store }) })]))

describe("upstream entries behind a route", () => {
  env({ FORGES_PROXY_PUBLIC: "1" })

  it("are tagged like the response, and reported per request", async () => {
    const url = new URL("/github/github.com/repos.get", "http://proxy.test")
    url.searchParams.set(
      "args",
      JSON.stringify([{ forge: "github", instance: "github.com", owner: "acme", name: "widgets" }]),
    )
    const first = await app.fetch(new Request(url))
    assert.equal(first.headers.get("x-upstream-cache"), "fetched")
    assert.deepEqual(tagged, [first.headers.get("netlify-cache-tag")!.split(",")])
    assert.ok(tagged[0]!.includes("github:github.com/@42"))
    const second = await app.fetch(new Request(url))
    assert.equal(second.headers.get("x-upstream-cache"), "fresh")
  })
})
