import assert from "node:assert/strict"
import { it } from "node:test"
import { verbs } from "forges/schema"
import { OPTIONS_AT } from "./options.ts"

it("matches the options position of every verb in forges/schema", () => {
  const expected = Object.fromEntries(
    Object.entries(verbs).flatMap(([name, verb]) => {
      const at = verb.params.findIndex((param) => param.options)
      return at < 0 ? [] : [[name, at]]
    }),
  )
  assert.deepEqual(OPTIONS_AT, expected)
})
