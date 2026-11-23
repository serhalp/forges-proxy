import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { describe, it } from "node:test"
import { compatible, FORGES_VERSION } from "./version.ts"

describe("FORGES_VERSION", () => {
  it("matches the installed forges package version", () => {
    const manifest = new URL("../package.json", import.meta.resolve("forges"))
    assert.equal(FORGES_VERSION, JSON.parse(readFileSync(manifest, "utf8")).version)
  })
})

describe("compatible", () => {
  it("matches minor versions under 0.x and major versions from 1.0+", () => {
    assert.ok(compatible("0.3.0", "0.3.7"))
    assert.ok(!compatible("0.3.0", "0.4.0"))
    assert.ok(compatible("1.2.0", "1.9.3"))
    assert.ok(!compatible("1.2.0", "2.0.0"))
  })
})
