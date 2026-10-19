import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { usePurge } from "#server/utils/purge.ts"

function recordFetch(t: { mock: { method: typeof import("node:test").mock.method } }) {
  const sent: Array<{ url: string; init: RequestInit }> = []
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    sent.push({ url: String(url), init })
    return new Response("{}")
  })
  return sent
}

describe("usePurge", () => {
  it("is undefined without a CDN in the env", () => {
    assert.equal(usePurge({}), undefined)
    assert.equal(usePurge({ CLOUDFLARE_ZONE_ID: "zone" }), undefined)
  })

  it("purges Netlify by tag with the token Netlify provides", async (t) => {
    const sent = recordFetch(t)
    const vars = { NETLIFY_PURGE_API_TOKEN: "ntl", SITE_ID: "site" }
    Object.assign(process.env, vars)
    t.after(() => {
      for (const key of Object.keys(vars)) delete process.env[key]
    })
    await usePurge()!(["a", "b"])
    assert.equal(sent[0]!.url, "https://api.netlify.com/api/v1/purge")
    assert.equal(new Headers(sent[0]!.init.headers).get("authorization"), "Bearer ntl")
    assert.deepEqual(JSON.parse(String(sent[0]!.init.body)), {
      cache_tags: ["a", "b"],
      site_id: "site",
    })
  })

  it("purges Cloudflare by tag, in batches it accepts", async (t) => {
    const sent = recordFetch(t)
    const tags = Array.from({ length: 31 }, (_, index) => `t${index}`)
    await usePurge({ CLOUDFLARE_ZONE_ID: "zone", CLOUDFLARE_API_TOKEN: "cf" })!(tags)
    assert.deepEqual(
      sent.map(({ url }) => url),
      Array(2).fill("https://api.cloudflare.com/client/v4/zones/zone/purge_cache"),
    )
    assert.deepEqual(
      sent.map(({ init }) => JSON.parse(String(init.body)).tags.length),
      [30, 1],
    )
    assert.equal(new Headers(sent[0]!.init.headers).get("authorization"), "Bearer cf")
  })
})
