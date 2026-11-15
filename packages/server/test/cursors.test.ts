import assert from "node:assert/strict"
import { describe, it } from "node:test"
import type { Env } from "../src/context.ts"
import { createServer } from "../src/index.ts"
import * as v from "valibot"

const repo = { forge: "github", instance: "github.com", owner: "o", name: "r" }
const NEXT = "https://api.github.com/repositories/1/contributors?page=2"

/** A proxy in front of a GitHub that answers every listing with one item and a next page, recording what it fetched. */
function proxy(env: Env, headers: HeadersInit = {}) {
  const fetched: string[] = []
  const server = createServer({
    env,
    fetch: async (input, init) => {
      const request = new Request(input, init)
      fetched.push(request.url)
      return Response.json([{ login: "a", id: 1, contributions: 1 }], {
        headers: { link: `<${NEXT}>; rel="next"` },
      })
    },
  })
  const contributors = (options?: object) =>
    server.fetch(
      new Request(
        `http://proxy.test/github/github.com/repos.contributors?args=${encodeURIComponent(
          JSON.stringify(options ? [repo, options] : [repo]),
        )}`,
        { headers },
      ),
    )
  return { fetched, contributors }
}

const Page = v.object({ cursor: v.record(v.string(), v.unknown()) })

describe("cursors", () => {
  describe("on a public instance with a token", () => {
    const env = { FORGES_PROXY_PUBLIC: "1", FORGES_GITHUB_TOKEN: "t" }

    it("signs the next page and follows it", async () => {
      const { fetched, contributors } = proxy(env)
      const { cursor } = v.parse(Page, await (await contributors()).json())
      assert.equal(cursor.nextUrl, NEXT)
      assert.equal(typeof cursor.signature, "string")
      assert.equal((await contributors({ cursor })).status, 200)
      assert.equal(fetched.at(-1), NEXT)
    })

    it("refuses a nextUrl it didn't sign", async () => {
      const { fetched, contributors } = proxy(env)
      const { cursor } = v.parse(Page, await (await contributors()).json())
      for (const forged of [
        { nextUrl: "https://api.github.com/repos/o/r/collaborators" },
        { ...cursor, nextUrl: "https://api.github.com/user/repos" },
        { ...cursor, signature: "nope" },
      ]) {
        assert.equal((await contributors({ cursor: forged })).status, 400)
      }
      assert.equal(fetched.length, 1)
    })

    it("refuses another deployment's signatures", async () => {
      const { cursor } = v.parse(Page, await (await proxy(env).contributors()).json())
      const other = proxy({ ...env, FORGES_GITHUB_TOKEN: "other" })
      assert.equal((await other.contributors({ cursor })).status, 400)
    })
  })

  it("leaves cursors alone where nothing needs protecting", async () => {
    for (const { contributors } of [
      // The caller holds the secret, so it's trusted.
      proxy({ FORGES_PROXY_SECRET: "s", FORGES_GITHUB_TOKEN: "t" }, { authorization: "Bearer s" }),
      // Anonymous: no credential to misuse.
      proxy({ FORGES_PROXY_PUBLIC: "1", FORGES_GITHUB_ENABLED: "1" }),
    ]) {
      const { cursor } = v.parse(Page, await (await contributors()).json())
      assert.equal(cursor.signature, undefined)
      assert.equal((await contributors({ cursor: { nextUrl: NEXT } })).status, 200)
    }
  })
})
