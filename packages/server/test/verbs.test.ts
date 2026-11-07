import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { createForges } from "forges"
import { fake } from "forges/fake"
import { manifest } from "#src/manifest.ts"
import { callVerb, routedVerb, withSignal } from "#src/verbs.ts"
import { routableVerbs } from "#scripts/generate-manifest.ts"
import * as v from "valibot"

const VERBS = routableVerbs()

describe("routableVerbs", () => {
  it("leaves out verbs with no safe HTTP form", () => {
    for (const verb of [
      "installations.token",
      "installations.provider",
      "webhooks.ingest",
      "sources.stream",
    ]) {
      assert.equal(VERBS.has(verb), false, verb)
    }
  })

  it("classifies listings, writes and account verbs from the capability table", () => {
    const plain = { write: false, account: false, listing: false }
    assert.deepEqual(VERBS.get("repos.get"), plain)
    assert.deepEqual(VERBS.get("threads.list"), { ...plain, listing: true })
    assert.deepEqual(VERBS.get("threads.createComment"), { ...plain, write: true })
    assert.deepEqual(VERBS.get("users.me"), { ...plain, account: true })
  })
})

describe("routedVerb", () => {
  it("routes writes and account verbs only on a private instance", () => {
    assert.equal(routedVerb("repos.get", "public"), manifest.verbs["repos.get"])
    assert.equal(routedVerb("threads.createComment", "public"), undefined)
    assert.equal(routedVerb("users.me", "public"), undefined)
    assert.equal(
      routedVerb("threads.createComment", "private"),
      manifest.verbs["threads.createComment"],
    )
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
    const repo = v.parse(
      v.object({ description: v.string() }),
      await callVerb(forges.providers[0], "repos.get", {}, [ref]),
    )
    assert.equal(repo.description, "Widgets")
  })

  it("reads one page of a listing", async () => {
    const provider = fake({
      seed: {
        repos: [{ repo: "acme/widgets" }],
        threads: [{ repo: "acme/widgets", kind: "issue", title: "Bug" }],
      },
    })
    const ref = { forge: "fake", instance: "fake.test", owner: "acme", name: "widgets" }
    const page = v.parse(
      v.object({ items: v.array(v.object({ title: v.string() })) }),
      await callVerb(provider, "threads.list", { listing: true }, [ref]),
    )
    assert.deepEqual(
      page.items.map((thread) => thread.title),
      ["Bug"],
    )
  })
})

describe("withSignal", () => {
  const verb = (name: string) => manifest.verbs[name]
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
    const noOptions = { ...verb("repos.get"), params: [verb("repos.get").params[0]] }
    assert.deepEqual(withSignal(noOptions, [repo], signal), [repo])
  })
})
