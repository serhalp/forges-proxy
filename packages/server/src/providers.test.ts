import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { providers } from "./providers.ts"

const silent = { error: () => {} }

const names = (env: Record<string, string>, anonymous: boolean) =>
  providers(env, { fetch, anonymous, logger: silent }).providers.map(
    (provider) => `${provider.forge}:${provider.instance}`,
  )

describe("providers", () => {
  it("serves only what the env configures by default", () => {
    assert.deepEqual(names({}, false), [])
    assert.deepEqual(names({ FORGES_GITHUB_ENABLED: "1" }, false), ["github:github.com"])
  })

  it("adds every forge readable without credentials, when asked", () => {
    const all = names({}, true)
    for (const name of ["github:github.com", "gitlab:gitlab.com", "forgejo:codeberg.org"]) {
      assert.ok(all.includes(name), name)
    }
    // Its reads go to hosts that callers name.
    assert.ok(!all.some((name) => name.startsWith("tangled:")))
  })

  it("leaves a forge the env mentions as the env says", () => {
    // Skipped for want of a token, and not replaced by the anonymous default.
    const all = names({ FORGES_GITLAB_BASE_URL: "https://git.example" }, true)
    assert.ok(!all.some((name) => name.startsWith("gitlab:")))
    assert.ok(all.includes("github:github.com"))
  })

  it("logs each set the env configures that can't be built, but not anonymous defaults", () => {
    const errors: unknown[] = []
    providers(
      { FORGES_GITLAB_BASE_URL: "https://git.example" },
      { fetch, anonymous: true, logger: { error: (event) => void errors.push(event) } },
    )
    assert.equal(errors.length, 1)
    assert.partialDeepStrictEqual(errors[0], { message: "Provider skipped", forge: "gitlab" })
  })
})
