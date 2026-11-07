import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { reviveArgs, serialise } from "#src/wire.ts"
import * as v from "valibot"

describe("reviveArgs", () => {
  it("revives output and input date fields at any depth", () => {
    const [ref, options] = v.parse(
      v.tuple([
        v.object({ createdAt: v.date() }),
        v.object({ since: v.date(), nested: v.object({ before: v.date() }) }),
      ]),
      reviveArgs([
        { createdAt: "2026-01-01T00:00:00Z" },
        { since: "2026-02-01T00:00:00Z", nested: { before: "2026-03-01T00:00:00Z" } },
      ]),
    )
    assert.deepEqual(ref.createdAt, new Date("2026-01-01T00:00:00Z"))
    assert.deepEqual(options.since, new Date("2026-02-01T00:00:00Z"))
    assert.deepEqual(options.nested.before, new Date("2026-03-01T00:00:00Z"))
  })

  it("decodes tagged bytes, and only those", () => {
    const [change, other] = v.parse(
      v.tuple([v.object({ content: v.instance(Uint8Array) }), v.unknown()]),
      reviveArgs([
        { path: "a.bin", content: { $bytes: "AP8B" } },
        { $bytes: "AP8B", extra: 1 },
      ]),
    )
    assert.deepEqual(change.content, new Uint8Array([0, 255, 1]))
    assert.deepEqual(other, { $bytes: "AP8B", extra: 1 })
  })

  it("leaves other strings, invalid dates and forge payloads alone", () => {
    const args = [
      { title: "2026-01-01", since: "not a date", raw: { createdAt: "2026-01-01T00:00:00Z" } },
    ]
    assert.deepEqual(reviveArgs(args), args)
  })
})

describe("serialise", () => {
  it("encodes bytes as base64", () => {
    const json = serialise(
      { encoding: "binary", content: new TextEncoder().encode("hi") },
      { raw: false },
    )
    assert.deepEqual(JSON.parse(json), { encoding: "binary", content: { $bytes: "aGk=" } })
  })

  it("drops raw payloads unless asked for", () => {
    const value = { title: "t", raw: { secret: 1 }, items: [{ raw: 2 }] }
    assert.deepEqual(JSON.parse(serialise(value, { raw: false })), { title: "t", items: [{}] })
    assert.deepEqual(JSON.parse(serialise(value, { raw: true })), value)
  })
})
