import assert from "node:assert/strict"
import { beforeEach, describe, it } from "node:test"
import { createForges } from "forges"
import { fake } from "forges/fake"
import { signDelivery } from "forges/testing"
import { createProxy, env, recorded } from "./support/proxy.ts"
import * as v from "valibot"

const factory = fake({
  webhookSecret: "whsec",
  seed: {
    repos: [{ repo: "acme/widgets", description: "Widgets" }],
    threads: [{ repo: "acme/widgets", kind: "issue", title: "Bug" }],
  },
})
const app = createProxy(createForges([factory]))

const repo = { forge: "fake", instance: "fake.test", owner: "acme", name: "widgets" }
// Webhook payloads name repositories by id too, which `repoKey` prefers.
const event = {
  kind: "comment",
  summary: "Commented",
  occurredAt: "2026-10-18T00:00:00Z",
  source: "webhook",
  payload: {},
  repo: { ...repo, externalId: "42" },
  thread: { ...repo, repo: { ...repo, externalId: "42" }, kind: "issue", number: "1" },
}

async function deliver(
  body: string,
  headers: Record<string, string>,
  path = "/webhooks/fake/fake.test",
) {
  return app.fetch(
    new Request(new URL(path, "http://proxy.test"), { method: "POST", headers, body }),
  )
}

describe("webhooks", () => {
  it("purges both keys of every repository a delivery concerns", async () => {
    const body = JSON.stringify([event])
    const response = await deliver(body, await signDelivery("fake", body, "whsec"))
    assert.equal(response.status, 200)
    assert.deepEqual(recorded.purges, [["fake:fake.test/@42", "fake:fake.test/acme/widgets"]])
  })

  it("rejects a delivery with a bad signature, purging nothing", async () => {
    const body = JSON.stringify([event])
    const response = await deliver(body, await signDelivery("fake", body, "wrong"))
    assert.equal(response.status, 401)
    assert.equal(
      v.parse(v.object({ error: v.object({ name: v.string() }) }), await response.json()).error
        .name,
      "WebhookVerificationError",
    )
    assert.deepEqual(recorded.purges, [])
  })

  it("404s for a forge the proxy doesn't serve", async () => {
    const body = JSON.stringify([event])
    const headers = await signDelivery("fake", body, "whsec")
    assert.equal((await deliver(body, headers, "/webhooks/github/github.com")).status, 404)
  })

  describe("on a private instance", () => {
    env({ FORGES_PROXY_SECRET: "s3cret" })

    it("needs no proxy secret, since the forge signs deliveries", async () => {
      const body = JSON.stringify([event])
      assert.equal((await deliver(body, await signDelivery("fake", body, "whsec"))).status, 200)
    })
  })
})

describe("handleEvents", () => {
  const calls: { events: unknown[]; source: unknown; purgedBefore: number }[] = []
  const logged: Record<string, unknown>[] = []
  let fail = false
  const handling = createProxy(createForges([factory]), {
    logger: { error: (entry) => void logged.push(entry) },
    handleEvents: (events, source) => {
      calls.push({ events, source, purgedBefore: recorded.purges.length })
      if (fail) throw new Error("queue down")
    },
  })
  beforeEach(() => {
    calls.length = 0
    logged.length = 0
    fail = false
  })

  async function deliverTo(body: string, headers: Record<string, string>) {
    return handling.fetch(
      new Request("http://proxy.test/webhooks/fake/fake.test", { method: "POST", headers, body }),
    )
  }

  it("gets a delivery's events and its source, after the purge", async () => {
    const body = JSON.stringify([event])
    const response = await deliverTo(body, await signDelivery("fake", body, "whsec"))
    assert.equal(response.status, 200)
    assert.equal(calls.length, 1)
    assert.deepEqual(calls[0].source, { forge: "fake", instance: "fake.test" })
    assert.equal(calls[0].events.length, 1)
    assert.equal(calls[0].purgedBefore, 1)
  })

  it("answers 500 when it throws, after the purge", async () => {
    fail = true
    const body = JSON.stringify([event])
    const response = await deliverTo(body, await signDelivery("fake", body, "whsec"))
    assert.equal(response.status, 500)
    assert.equal(recorded.purges.length, 1)
    assert.equal(logged[0]?.message, "handleEvents failed")
    assert.doesNotMatch(await response.text(), /queue down/)
  })

  it("isn't called for a delivery with a bad signature", async () => {
    const body = JSON.stringify([event])
    await deliverTo(body, await signDelivery("fake", body, "wrong"))
    assert.equal(calls.length, 0)
  })
})

describe("cache tags", () => {
  env({ FORGES_PROXY_PUBLIC: "1" })

  it("tag a public read with its instance and the repositories it names", async () => {
    const url = new URL("/fake/fake.test/repos.get", "http://proxy.test")
    url.searchParams.set("args", JSON.stringify([repo]))
    const response = await app.fetch(new Request(url))
    const tags = response.headers.get("cache-tag")!.split(",")
    assert.ok(tags.includes("fake:fake.test"))
    assert.ok(tags.includes("fake:fake.test/acme/widgets"))
  })
})
