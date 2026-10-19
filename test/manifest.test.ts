import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { DATE_FIELDS } from "forges"
import type { Schema } from "#server/utils/manifest.ts"
import { manifest } from "#server/utils/manifest.ts"
import { INPUT_DATE_FIELDS } from "#server/utils/wire.ts"
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

  it("has no input date field that the proxy wouldn't revive", () => {
    const names = new Set<string>()
    const seen = new Set<string>()
    const visit = (schema: unknown): void => {
      if (!schema || typeof schema !== "object") {
        return
      }
      const { $ref, properties } = schema as Schema & { $ref?: string }
      const name = $ref?.split("/").pop()
      if (name && !seen.has(name)) {
        seen.add(name)
        visit(manifest.schemas[name])
      }
      for (const [key, value] of Object.entries((properties ?? {}) as Record<string, Schema>)) {
        const branches = [value, ...((value.anyOf as Schema[] | undefined) ?? [])]
        if (branches.some((branch) => branch.format === "date-time")) {
          names.add(key)
        }
      }
      Object.values(schema).forEach(visit)
    }
    Object.values(manifest.verbs).forEach((verb) => verb.params.forEach(visit))
    assert.ok(names.size > 0)
    for (const name of names) {
      assert.ok(DATE_FIELDS.has(name) || INPUT_DATE_FIELDS.has(name), name)
    }
  })

  it("resolves every reference", () => {
    for (const [, ref] of JSON.stringify(manifest).matchAll(
      /"\$ref":"#\/components\/schemas\/([^"]+)"/g,
    )) {
      assert.ok(manifest.schemas[ref!], ref)
    }
  })
})
