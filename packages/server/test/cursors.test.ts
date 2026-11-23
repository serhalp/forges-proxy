import assert from "node:assert/strict"
import { describe, it } from "node:test"
import type { Env } from "../src/context.ts"
import { createServer } from "../src/index.ts"
import * as v from "valibot"

const repo = { forge: "github", instance: "github.com", owner: "o", name: "r" }
const NEXT = "https://api.github.com/repositories/1/contributors?page=2"

/** Creates a proxy backed by a stubbed GitHub `fetch` that returns a single contributor and a `Link` next-page header. */
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
  describe("on a public instance with an authenticated provider", () => {
    const env = { FORGES_PROXY_PUBLIC: "1", FORGES_GITHUB_TOKEN: "t" }

    it("signs cursor.nextUrl and accepts the signed cursor on the next request", async () => {
      const { fetched, contributors } = proxy(env)
      const { cursor } = v.parse(Page, await (await contributors()).json())
      assert.equal(cursor.nextUrl, NEXT)
      assert.equal(typeof cursor.signature, "string")
      assert.equal((await contributors({ cursor })).status, 200)
      assert.equal(fetched.at(-1), NEXT)
    })

    it("rejects unsigned or tampered nextUrl values", async () => {
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

    it("rejects cursors signed with different credentials", async () => {
      const { cursor } = v.parse(Page, await (await proxy(env).contributors()).json())
      const other = proxy({ ...env, FORGES_GITHUB_TOKEN: "other" })
      assert.equal((await other.contributors({ cursor })).status, 400)
    })
  })

  it("does not sign cursors on private instances or anonymous providers", async () => {
    for (const { contributors } of [
      proxy({ FORGES_PROXY_SECRET: "s", FORGES_GITHUB_TOKEN: "t" }, { authorization: "Bearer s" }),
      proxy({ FORGES_PROXY_PUBLIC: "1", FORGES_GITHUB_ENABLED: "1" }),
    ]) {
      const { cursor } = v.parse(Page, await (await contributors()).json())
      assert.equal(cursor.signature, undefined)
      assert.equal((await contributors({ cursor: { nextUrl: NEXT } })).status, 200)
    }
  })
})
