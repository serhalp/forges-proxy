import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { serialize } from "./wire.ts"

describe("serialize", () => {
  it("encodes dates and bytes as tags", () => {
    const json = serialize(
      {
        createdAt: new Date("2026-01-01T00:00:00Z"),
        encoding: "binary",
        content: new TextEncoder().encode("hi"),
      },
      { raw: false },
    )
    assert.deepEqual(JSON.parse(json), {
      createdAt: { $date: "2026-01-01T00:00:00.000Z" },
      encoding: "binary",
      content: { $bytes: "aGk=" },
    })
  })

  it("drops raw payloads unless asked for", () => {
    const value = { title: "t", raw: { secret: 1 }, items: [{ raw: 2 }] }
    assert.deepEqual(JSON.parse(serialize(value, { raw: false })), { title: "t", items: [{}] })
    assert.deepEqual(JSON.parse(serialize(value, { raw: true })), value)
  })
})
