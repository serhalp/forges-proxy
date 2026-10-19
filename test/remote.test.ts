import assert from "node:assert/strict"
import { describe, it } from "node:test"
import type { ForgeProvider } from "forges"
import {
  createForges,
  ForbiddenError,
  github,
  NotFoundError,
  RateLimitedError,
  reviveDates,
  UnsupportedOperationError,
} from "forges"
import { fake } from "forges/fake"
import { connect } from "#client/remote.ts"
import { serialise } from "#server/utils/wire.ts"
import { createProxy, env } from "./support/proxy.ts"

const factory = fake({
  seed: {
    repos: [{ repo: "acme/widgets", description: "Widgets" }],
    files: [{ repo: "acme/widgets", path: "logo.png", content: new Uint8Array([0, 255, 1]) }],
    threads: [
      { repo: "acme/widgets", kind: "issue", title: "One" },
      { repo: "acme/widgets", kind: "issue", title: "Two" },
      { repo: "acme/widgets", kind: "pull_request", title: "Three" },
    ],
    runs: [{ repo: "acme/widgets", name: "ci", jobs: [{ name: "test", log: "ok\n" }] }],
  },
})
const direct = factory.create()
const app = await createProxy(createForges([direct, github()]))
// In-process h3 ignores an aborted signal, where a real `fetch` rejects with it.
const fetch = async (url: string, init?: RequestInit) => {
  init?.signal?.throwIfAborted()
  return app.fetch(new Request(url, init))
}

const repo = { forge: "fake", instance: "fake.test", owner: "acme", name: "widgets" }
const issue = { forge: "fake", instance: "fake.test", repo, kind: "issue" as const, number: "1" }

/** What a direct call's result looks like once it has crossed the wire. */
const overTheWire = <T>(value: T): T => reviveDates(JSON.parse(serialise(value, { raw: false })))

async function remote(secret?: string): Promise<{ fake: ForgeProvider; github: ForgeProvider }> {
  const [fakeProvider, githubProvider] = await connect({ url: "http://proxy.test", secret, fetch })
  return { fake: fakeProvider!, github: githubProvider! }
}

describe("connect", () => {
  env({ FORGES_PROXY_SECRET: "s3cret" })

  it("builds a provider per forge the proxy serves", async () => {
    const { fake, github } = await remote("s3cret")
    assert.deepEqual([fake.forge, fake.instance], ["fake", "fake.test"])
    assert.deepEqual(fake.capabilities, overTheWire(direct.capabilities))
    assert.equal(github.forge, "github")
  })

  it("rejects a wrong secret", async () => {
    await assert.rejects(remote("nope"), { status: 401 })
  })

  it("plugs into createForges", async () => {
    const forges = createForges(Object.values(await remote("s3cret")))
    assert.equal((await forges.repos.get(repo)).description, "Widgets")
  })

  it("fans out registry listings over the providers' pages", async () => {
    const forges = createForges([(await remote("s3cret")).fake])
    const threads = await Array.fromAsync(forges.search.threads({ repo }))
    const titles = threads.map((thread) => thread.title)
    assert.deepEqual(titles.toSorted(), ["One", "Three", "Two"])
  })
})

describe("remote provider", () => {
  env({ FORGES_PROXY_SECRET: "s3cret" })

  it("reads what the provider reads, dates included", async () => {
    const { fake } = await remote("s3cret")
    const repoRead = await fake.repos.get(repo)
    assert.deepEqual(repoRead, overTheWire(await direct.repos.get(repo)))
    assert.ok((await fake.threads.get(issue)).createdAt instanceof Date)
  })

  it("pages through a listing", async () => {
    const { fake } = await remote("s3cret")
    const titles = async (provider: ForgeProvider) => {
      const seen = []
      for await (const thread of provider.threads.list(repo, { perPage: 1, state: "all" })) {
        seen.push(thread.title)
      }
      return seen
    }
    assert.deepEqual(await titles(fake), await titles(direct))
    assert.equal((await titles(fake)).length, 3)
  })

  it("returns file bytes as bytes", async () => {
    const { fake } = await remote("s3cret")
    const file = await fake.contents.file(repo, "logo.png")
    assert.deepEqual(file.content, new Uint8Array([0, 255, 1]))
  })

  it("streams job logs", async () => {
    const { fake } = await remote("s3cret")
    const [run] = (await fake.ci.runsPage(repo)).items
    const [job] = (await fake.ci.jobsPage(run!.ref)).items
    assert.equal(await new Response(await fake.ci.log(job!.ref)).text(), "ok\n")
  })

  it("resolves with nothing where the provider does", async () => {
    const { fake } = await remote("s3cret")
    assert.equal(await fake.releases.latest(repo), undefined)
  })

  it("writes", async () => {
    const { fake } = await remote("s3cret")
    const comment = await fake.threads.comment(issue, "Over the wire")
    assert.equal(comment.body, "Over the wire")
    assert.ok(
      (await direct.threads.commentsPage(issue)).items.some(
        (item) => item.body === "Over the wire",
      ),
    )
  })

  it("rebuilds forge errors with their class and fields", async () => {
    const { fake } = await remote("s3cret")
    factory.failNext(
      "repos.get",
      new NotFoundError("Gone", 404, "", { forge: "fake", instance: "fake.test" }),
    )
    await assert.rejects(fake.repos.get(repo), (error) => {
      assert.ok(error instanceof NotFoundError)
      assert.equal(error.status, 404)
      assert.equal(error.instance, "fake.test")
      return true
    })
    const resetAt = new Date(Date.now() + 60_000)
    factory.failNext(
      "repos.get",
      new RateLimitedError("Slow", 429, "", { resetAt, secondary: true }),
    )
    await assert.rejects(fake.repos.get(repo), (error) => {
      assert.ok(error instanceof RateLimitedError)
      assert.deepEqual(error.resetAt, new Date(Math.floor(resetAt.getTime())))
      assert.equal(error.secondary, true)
      return true
    })
    factory.failNext("repos.get", new ForbiddenError("No", 403, "", "sso_required"))
    await assert.rejects(fake.repos.get(repo), { name: "ForbiddenError", reason: "sso_required" })
  })

  it("aborts with the caller's signal", async () => {
    const { fake } = await remote("s3cret")
    await assert.rejects(fake.repos.get(repo, { signal: AbortSignal.abort() }), {
      name: "AbortError",
    })
  })

  it("answers the sync helpers locally", async () => {
    const { github } = await remote("s3cret")
    const ref = { forge: "github", instance: "github.com", owner: "acme", name: "widgets" }
    assert.equal(github.urlFor({ repo: ref }), "https://github.com/acme/widgets")
    assert.equal(github.parseUrl("https://github.com/acme/widgets")?.repo?.name, "widgets")
    assert.equal(github.webOrigin, "https://github.com")
  })
})

describe("remote provider of a public instance", () => {
  env({ FORGES_PROXY_PUBLIC: "1" })

  it("reports and rejects the verbs the proxy doesn't route", async () => {
    const { fake } = await remote()
    assert.equal(fake.can("repos.get"), true)
    assert.equal(fake.can("threads.comment", "issue"), false)
    assert.equal(fake.support("users.me"), false)
    await assert.rejects(fake.threads.comment(issue, "x"), UnsupportedOperationError)
    await assert.rejects(async () => {
      for await (const _ of fake.notifications.list()) {
        // unreachable
      }
    }, UnsupportedOperationError)
  })
})
