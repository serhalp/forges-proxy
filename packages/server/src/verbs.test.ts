import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { createForges } from "forges"
import { fake } from "forges/fake"
import * as v from "valibot"
import { manifest } from "./manifest.ts"
import { callVerb, routedVerb, withSignal } from "./verbs.ts"

describe("manifest", () => {
  it("excludes non-routable verbs", () => {
    for (const verb of [
      "installations.token",
      "installations.provider",
      "installations.providers",
      "webhooks.verify",
      "webhooks.ingest",
      "sources.stream",
    ]) {
      assert.equal(manifest.verbs[verb], undefined, verb)
    }
  })

  it("classifies listings, writes, and account verbs", () => {
    const kind = (name: string) => {
      const { write, account, listing = false } = manifest.verbs[name]
      return { write, account, listing }
    }
    assert.deepEqual(kind("repos.get"), { write: false, account: false, listing: false })
    assert.deepEqual(kind("threads.list"), { write: false, account: false, listing: true })
    assert.deepEqual(kind("threads.create"), { write: true, account: false, listing: false })
    assert.deepEqual(kind("users.me"), { write: false, account: true, listing: false })
  })
})

describe("routedVerb", () => {
  it("routes writes and account verbs only in private mode", () => {
    assert.equal(routedVerb("repos.get", "public"), manifest.verbs["repos.get"])
    assert.equal(routedVerb("threads.createComment", "public"), undefined)
    assert.equal(routedVerb("users.me", "public"), undefined)
    assert.equal(
      routedVerb("threads.createComment", "private"),
      manifest.verbs["threads.createComment"],
    )
  })

  it("returns undefined for unknown verbs and Object.prototype properties", () => {
    for (const name of ["repos.nope", "constructor", "__proto__", "toString"]) {
      assert.equal(routedVerb(name, "private"), undefined, name)
    }
  })
})

describe("callVerb", () => {
  it("invokes the verb on the provider with the given arguments", async () => {
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

  it("returns a single page for listing verbs", async () => {
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

  it("injects signal into the verb's options argument", () => {
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

  it("leaves arguments unchanged when the verb has no options parameter or options is not an object", () => {
    assert.deepEqual(withSignal(verb("repos.get"), [repo, "nope"], signal), [repo, "nope"])
    const noOptions = { ...verb("repos.get"), params: [verb("repos.get").params[0]] }
    assert.deepEqual(withSignal(noOptions, [repo], signal), [repo])
  })
})
