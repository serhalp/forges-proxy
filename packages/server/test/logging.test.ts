import assert from "node:assert/strict"
import { beforeEach, describe, it } from "node:test"
import { createForges } from "forges"
import { fake } from "forges/fake"
import { createProxy, env } from "./support/proxy.ts"

const requests: Record<string, unknown>[] = []
const app = createProxy(createForges([fake({ seed: { repos: [{ repo: "acme/widgets" }] } })]), {
  logger: { info: (entry) => void requests.push(entry), error: () => {} },
})

describe("request logging", () => {
  env({ FORGES_PROXY_SECRET: "s3cret" })
  beforeEach(() => {
    requests.length = 0
  })

  it("logs each request at info, without its query", async () => {
    await app.fetch(new Request("http://proxy.test/fake/fake.test/repos.get?args=%5B%5D"))
    assert.equal(requests.length, 1)
    assert.deepEqual(
      { ...requests[0], durationMs: 0 },
      {
        message: "request",
        method: "GET",
        path: "/fake/fake.test/repos.get",
        status: 401,
        durationMs: 0,
      },
    )
  })
})

describe("unhandled errors", () => {
  const errors: Record<string, unknown>[] = []
  const broken = createForges([fake()])
  broken.for = () => {
    throw new Error("boom")
  }
  const brokenApp = createProxy(broken, { logger: { error: (entry) => void errors.push(entry) } })

  it("go to the logger, not to h3's console.error, and leak nothing", async () => {
    const response = await brokenApp.fetch(
      new Request("http://proxy.test/webhooks/fake/fake.test", { method: "POST", body: "{}" }),
    )
    assert.equal(response.status, 500)
    assert.doesNotMatch(await response.text(), /boom/)
    assert.equal(errors[0]?.message, "Unhandled error")
  })
})
