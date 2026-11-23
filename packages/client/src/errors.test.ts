import assert from "node:assert/strict"
import { describe, it } from "node:test"
import * as forges from "forges"
import { ERRORS } from "./errors.ts"

const isErrorClass = (value: unknown): value is typeof Error =>
  typeof value === "function" && value.prototype instanceof Error

describe("ERRORS", () => {
  it("includes every Error subclass exported by forges", () => {
    const exported = Object.values(forges)
      .filter(isErrorClass)
      .map((Class) => Class.name)
    const compare = (a: string, b: string) => a.localeCompare(b)
    assert.deepEqual([...ERRORS.keys()].toSorted(compare), exported.toSorted(compare))
  })
})
