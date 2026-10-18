import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { createForges } from "forges"
import { fake } from "forges/fake"
import { callVerb, VERBS } from "#server/utils/verbs.ts"

describe("VERBS", () => {
  it("leaves out verbs with no safe HTTP form", () => {
    for (const verb of [
      "installations.token",
      "installations.provider",
      "webhooks.ingest",
      "sources.subscribe",
    ]) {
      assert.equal(VERBS.has(verb), false, verb)
    }
  })

  it("exposes listings only as their page", () => {
    assert.equal(VERBS.has("threads.list"), false)
    assert.equal(VERBS.has("threads.listPage"), true)
  })

  it("classifies writes and account verbs from the capability table", () => {
    assert.deepEqual(VERBS.get("repos.get"), { write: false, account: false })
    assert.deepEqual(VERBS.get("threads.comment"), { write: true, account: false })
    assert.deepEqual(VERBS.get("users.me"), { write: false, account: true })
  })
})

describe("callVerb", () => {
  it("calls the verb on the provider with the given arguments", async () => {
    const forges = createForges([
      fake({ seed: { repos: [{ repo: "acme/widgets", description: "Widgets" }] } }),
    ])
    const ref = { forge: "fake", instance: "fake.test", owner: "acme", name: "widgets" }
    const repo = (await callVerb(forges.providers[0]!, "repos.get", [ref])) as {
      description: string
    }
    assert.equal(repo.description, "Widgets")
  })
})
