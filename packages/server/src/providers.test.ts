import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { providers } from "./providers.ts"

const silent = { error: () => {} }

const names = (env: Record<string, string>, anonymous: boolean) =>
  providers(env, { fetch, anonymous, logger: silent }).providers.map(
    (provider) => `${provider.forge}:${provider.instance}`,
  )

describe("providers", () => {
  it("only configures providers present in env by default", () => {
    assert.deepEqual(names({}, false), [])
    assert.deepEqual(names({ FORGES_GITHUB_ENABLED: "1" }, false), ["github:github.com"])
  })

  it("enables unconfigured forges that support anonymous reads when anonymous is true", () => {
    const all = names({}, true)
    for (const name of ["github:github.com", "gitlab:gitlab.com", "forgejo:codeberg.org"]) {
      assert.ok(all.includes(name), name)
    }
    // Tangled is excluded because its reads fetch caller-specified hosts.
    assert.ok(!all.some((name) => name.startsWith("tangled:")))
  })

  it("does not fall back to an anonymous default when a forge has partial env configuration", () => {
    const all = names({ FORGES_GITLAB_BASE_URL: "https://git.example" }, true)
    assert.ok(!all.some((name) => name.startsWith("gitlab:")))
    assert.ok(all.includes("github:github.com"))
  })

  it("logs skipped providers configured in env without logging skipped anonymous defaults", () => {
    const errors: unknown[] = []
    providers(
      { FORGES_GITLAB_BASE_URL: "https://git.example" },
      { fetch, anonymous: true, logger: { error: (event) => void errors.push(event) } },
    )
    assert.equal(errors.length, 1)
    assert.partialDeepStrictEqual(errors[0], { message: "Provider skipped", forge: "gitlab" })
  })
})
