import assert from "node:assert/strict"
import { describe, it } from "node:test"
import type { ForgeEvent } from "forges"
import { purgeTags, responseTags } from "./tags.ts"

const repo = { forge: "github", instance: "github.com", owner: "acme", name: "widgets" }

describe("responseTags", () => {
  it("tags every repository in the arguments and result, by path and by id", () => {
    const thread = {
      ref: { ...repo, repo: { ...repo, externalId: "42" }, kind: "issue", number: "1" },
    }
    assert.deepEqual(responseTags("github", "github.com", [repo], { items: [thread] }), [
      "github:github.com",
      "github:github.com/acme/widgets",
      "github:github.com/@42",
    ])
  })

  it("skips forge payloads", () => {
    const tags = responseTags("github", "github.com", {
      raw: { repo: { ...repo, name: "secret" } },
    })
    assert.deepEqual(tags, ["github:github.com"])
  })

  it("falls back to the instance tag past a header-sized number of repositories", () => {
    const repos = Array.from({ length: 51 }, (_, index) => ({ ...repo, name: `r${index}` }))
    assert.deepEqual(responseTags("github", "github.com", repos), ["github:github.com"])
  })
})

describe("purgeTags", () => {
  it("includes what affectedKeys names, and both keys of each repository", () => {
    // Partial events: `purgeTags` reads only these fields.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const event = {
      kind: "comment",
      repo: { ...repo, externalId: "42" },
      thread: { ...repo, repo: { ...repo, externalId: "42" }, kind: "issue", number: "1" },
      payload: { repository: { ...repo, name: "from-payload" } },
    } as unknown as ForgeEvent
    assert.deepEqual(purgeTags([event]).toSorted(), [
      "github:github.com/@42",
      "github:github.com/acme/widgets",
    ])
  })

  it("covers both paths of a renamed repository", () => {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const event = {
      kind: "repo",
      repo: { ...repo, name: "gadgets", externalId: "42" },
      detail: { type: "repo_renamed", from: "acme/widgets", to: "acme/gadgets" },
      payload: {},
    } as unknown as ForgeEvent
    const tags = purgeTags([event])
    assert.ok(tags.includes("github:github.com/acme/gadgets"))
    assert.ok(tags.includes("github:github.com/acme/widgets"))
  })
})
