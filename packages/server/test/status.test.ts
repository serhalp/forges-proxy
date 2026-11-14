import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { createForges } from "forges"
import { fake } from "forges/fake"
import { createServer } from "../src/index.ts"
import { createProxy, env } from "./support/proxy.ts"
import * as v from "valibot"

const forges = createForges([
  fake({ rateLimit: { limit: 10 }, seed: { repos: [{ repo: "acme/widgets" }] } }),
])
const app = createProxy(forges)
const repo = { forge: "fake", instance: "fake.test", owner: "acme", name: "widgets" }

const get = (path: string, headers?: HeadersInit) =>
  Promise.resolve(app.fetch(new Request(new URL(path, "http://proxy.test"), { headers })))

describe("GET /status", () => {
  env({ FORGES_PROXY_SECRET: "s3cret" })
  const authorization = { authorization: "Bearer s3cret" }

  it("needs the secret on a private instance", async () => {
    assert.equal((await get("/status")).status, 401)
  })

  it("reports the budgets the latest upstream responses left", async () => {
    await get(
      `/fake/fake.test/repos.get?args=${encodeURIComponent(JSON.stringify([repo]))}`,
      authorization,
    )
    const response = await get("/status", authorization)
    assert.equal(response.headers.get("cache-control"), "no-store")
    const { providers } = v.parse(
      v.object({
        providers: v.array(
          v.object({
            forge: v.string(),
            rateLimits: v.array(v.object({ limit: v.number(), remaining: v.number() })),
          }),
        ),
      }),
      await response.json(),
    )
    assert.equal(providers[0].forge, "fake")
    assert.equal(providers[0].rateLimits[0].limit, 10)
    assert.ok(providers[0].rateLimits[0].remaining < 10)
  })

  it("are also reported on each verb response, for the client's rateLimits()", async () => {
    const response = await get(
      `/fake/fake.test/repos.get?args=${encodeURIComponent(JSON.stringify([repo]))}`,
      authorization,
    )
    const budgets = v.parse(
      v.array(v.object({ limit: v.number() })),
      JSON.parse(response.headers.get("forges-rate-limits") ?? "null"),
    )
    assert.equal(budgets[0].limit, 10)
  })
})

describe("GET /", () => {
  env({ FORGES_PROXY_SECRET: "s3cret" })
  const Index = v.object({
    providers: v.array(
      v.object({ capabilities: v.object({ sources: v.object({ stream: v.unknown() }) }) }),
    ),
  })
  // A server per test, since each caches its providers' refined capabilities.
  const readerOf = (provider: ReturnType<typeof fake>) => {
    const server = createServer({ forges: createForges([provider]) })
    return async () => {
      const request = new Request("http://proxy.test/", {
        headers: { authorization: "Bearer s3cret" },
      })
      return v.parse(Index, await (await server.fetch(request)).json()).providers[0].capabilities
    }
  }

  it("reports capabilities refined by refreshCapabilities(), refreshed once", async (t) => {
    const provider = fake()
    const refresh = t.mock.method(provider, "refreshCapabilities", async () => ({
      ...provider.capabilities,
      sources: { ...provider.capabilities.sources, stream: false },
    }))
    const read = readerOf(provider)
    assert.equal((await read()).sources.stream, false)
    await read()
    assert.equal(refresh.mock.callCount(), 1)
  })

  it("falls back to the static capabilities when the forge doesn't answer", async (t) => {
    const provider = fake()
    t.mock.method(provider, "refreshCapabilities", async () => {
      throw new Error("down")
    })
    assert.equal((await readerOf(provider)()).sources.stream, provider.capabilities.sources.stream)
  })
})
