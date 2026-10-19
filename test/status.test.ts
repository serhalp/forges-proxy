import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { createForges } from "forges"
import { fake } from "forges/fake"
import { createProxy, env } from "./support/proxy.ts"

const forges = createForges([
  fake({ rateLimit: { limit: 10 }, seed: { repos: [{ repo: "acme/widgets" }] } }),
])
const app = await createProxy(forges)
const repo = { forge: "fake", instance: "fake.test", owner: "acme", name: "widgets" }

const get = (path: string, headers?: HeadersInit) =>
  Promise.resolve(app.fetch(new Request(new URL(path, "http://proxy.test"), { headers })))

describe("GET /v1/status", () => {
  env({ FORGES_PROXY_SECRET: "s3cret" })
  const authorization = { authorization: "Bearer s3cret" }

  it("needs the secret on a private instance", async () => {
    assert.equal((await get("/v1/status")).status, 401)
  })

  it("reports the budgets the latest upstream responses left", async () => {
    await get(
      `/v1/fake/fake.test/repos.get?args=${encodeURIComponent(JSON.stringify([repo]))}`,
      authorization,
    )
    const response = await get("/v1/status", authorization)
    assert.equal(response.headers.get("cache-control"), "no-store")
    const { providers } = (await response.json()) as {
      providers: Array<{ forge: string; rateLimits: Array<{ limit: number; remaining: number }> }>
    }
    assert.equal(providers[0]!.forge, "fake")
    assert.equal(providers[0]!.rateLimits[0]!.limit, 10)
    assert.ok(providers[0]!.rateLimits[0]!.remaining < 10)
  })
})
