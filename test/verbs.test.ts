import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { createForges } from "forges"
import { fake } from "forges/fake"
import { manifest } from "#server/utils/manifest.ts"
import { callVerb, routedVerb, withSignal } from "#server/utils/verbs.ts"
import { routableVerbs } from "#scripts/generate-manifest.ts"

const VERBS = routableVerbs()

describe("routableVerbs", () => {
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

describe("routedVerb", () => {
  it("routes writes and account verbs only on a private instance", () => {
    assert.equal(routedVerb("repos.get", "public"), manifest.verbs["repos.get"])
    assert.equal(routedVerb("threads.comment", "public"), undefined)
    assert.equal(routedVerb("users.me", "public"), undefined)
    assert.equal(routedVerb("threads.comment", "private"), manifest.verbs["threads.comment"])
  })

  it("knows no verb outside the manifest", () => {
    for (const name of ["repos.nope", "constructor", "__proto__", "toString"]) {
      assert.equal(routedVerb(name, "private"), undefined, name)
    }
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

describe("withSignal", () => {
  const verb = (name: string) => manifest.verbs[name]!
  const signal = new AbortController().signal
  const repo = { forge: "fake", instance: "fake.test", owner: "acme", name: "widgets" }

  it("adds the signal to the options, wherever they sit", () => {
    assert.deepEqual(withSignal(verb("repos.get"), [repo, { licence: true }], signal), [
      repo,
      { licence: true, signal },
    ])
    assert.deepEqual(withSignal(verb("repos.get"), [repo], signal), [repo, { signal }])
    assert.deepEqual(withSignal(verb("contents.compare"), [repo, "a"], signal), [
      repo,
      "a",
      undefined,
      { signal },
    ])
  })

  it("leaves arguments it can't add to alone", () => {
    assert.deepEqual(withSignal(verb("repos.get"), [repo, "nope"], signal), [repo, "nope"])
    const noOptions = { ...verb("repos.get"), params: [verb("repos.get").params[0]!] }
    assert.deepEqual(withSignal(noOptions, [repo], signal), [repo])
  })
})
