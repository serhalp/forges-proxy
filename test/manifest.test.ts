import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { manifest } from "#server/utils/manifest.ts"
import { VERBS } from "#server/utils/verbs.ts"
import { generateManifest } from "#scripts/generate-manifest.ts"

describe("manifest", () => {
  it("is fresh for the forges it's built against", () => {
    assert.deepEqual(
      generateManifest(),
      manifest,
      "server/manifest.json is stale; run node scripts/generate-manifest.ts",
    )
  })

  it("describes every routed verb, with its class", () => {
    assert.deepEqual(Object.keys(manifest.verbs).toSorted(), [...VERBS.keys()].toSorted())
    for (const [name, verb] of VERBS) {
      const { write, account } = manifest.verbs[name]!
      assert.deepEqual({ write, account }, verb, name)
    }
  })

  it("names each verb's options, and keeps `signal` off the wire", () => {
    for (const [name, verb] of Object.entries(manifest.verbs)) {
      assert.equal(verb.params.filter((param) => param.options).length, 1, name)
    }
    assert.ok(!JSON.stringify(manifest).includes('"signal"'))
  })

  it("resolves every reference", () => {
    for (const [, ref] of JSON.stringify(manifest).matchAll(
      /"\$ref":"#\/components\/schemas\/([^"]+)"/g,
    )) {
      assert.ok(manifest.schemas[ref!], ref)
    }
  })
})
