import assert from "node:assert/strict"
import { describe, it } from "node:test"
import type { ForgeEvent } from "forges"
import { purgeTags, responseTags } from "./tags.ts"

const repo = { forge: "github", instance: "github.com", owner: "acme", name: "widgets" }

describe("responseTags", () => {
  it("tags every repository in arguments and results by both path and externalId", () => {
    const thread = {
      ref: { ...repo, repo: { ...repo, externalId: "42" }, kind: "issue", number: "1" },
    }
    assert.deepEqual(responseTags("github", "github.com", [repo], { items: [thread] }), [
      "github:github.com",
      "github:github.com/acme/widgets",
      "github:github.com/@42",
    ])
  })

  it("ignores refs inside raw forge payloads", () => {
    const tags = responseTags("github", "github.com", {
      raw: { repo: { ...repo, name: "secret" } },
    })
    assert.deepEqual(tags, ["github:github.com"])
  })

  it("falls back to only the instance tag when repository tags exceed MAX_REPO_TAGS", () => {
    const repos = Array.from({ length: 51 }, (_, index) => ({ ...repo, name: `r${index}` }))
    assert.deepEqual(responseTags("github", "github.com", repos), ["github:github.com"])
  })
})

describe("purgeTags", () => {
  it("returns affectedKeys plus both path and externalId tags for each repository", () => {
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

  it("includes both old and new repository paths on a repo_renamed event", () => {
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
