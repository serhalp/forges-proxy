import assert from "node:assert/strict"
import { describe, it } from "node:test"
import type { ForgeProvider } from "forges"
import {
  createForges,
  ForbiddenError,
  github as githubForge,
  NotFoundError,
  RateLimitedError,
  reviveDates,
  UnsupportedOperationError,
} from "forges"
import { fake as fakeForge } from "forges/fake"
import { github as githubFactory } from "forges/github"
import { gitlab as gitlabFactory } from "forges/gitlab"
import { allFactories } from "../src/all.ts"
import { connect } from "../src/remote.ts"
import { FORGES_VERSION } from "../src/version.ts"
import { serialise } from "../../server/src/wire.ts"
import { createProxy, env } from "../../server/test/support/proxy.ts"
import * as v from "valibot"

const direct = fakeForge({
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
const app = createProxy(createForges([direct, githubForge()]))
// In-process h3 ignores an aborted signal, where a real `fetch` rejects with it and errors the body.
const fetch = async (url: string, init?: RequestInit) => {
  init?.signal?.throwIfAborted()
  const response = await app.fetch(new Request(url, init))
  const { status, statusText, headers } = response
  const body = response.body?.pipeThrough(new TransformStream(), {
    signal: init?.signal ?? undefined,
  })
  return new Response(body, { status, statusText, headers })
}

const repo = { forge: "fake", instance: "fake.test", owner: "acme", name: "widgets" }
const issue = { forge: "fake", instance: "fake.test", repo, kind: "issue" as const, number: "1" }

/** What a direct call's result looks like once it has crossed the wire. */
const overTheWire = <T>(value: T): T => reviveDates(JSON.parse(serialise(value, { raw: false })))

async function remote(secret?: string): Promise<{ fake: ForgeProvider; github: ForgeProvider }> {
  const [fakeProvider, githubProvider] = await connect({
    url: "http://proxy.test",
    secret,
    fetch,
    factories: allFactories,
  })
  return { fake: fakeProvider, github: githubProvider }
}

describe("connect", () => {
  env({ FORGES_PROXY_SECRET: "s3cret" })

  it("builds a provider per forge the proxy serves", async () => {
    const { fake, github } = await remote("s3cret")
    assert.deepEqual([fake.forge, fake.instance], ["fake", "fake.test"])
    assert.deepEqual(fake.capabilities, overTheWire(direct.capabilities))
    assert.equal(github.forge, "github")
  })

  it("reaches a proxy mounted under a path", async () => {
    const mounted = async (url: string, init?: RequestInit) => {
      const { pathname, search } = new URL(url)
      assert.match(pathname, /^\/forges\//)
      return fetch(`http://proxy.test${pathname.slice("/forges".length)}${search}`, init)
    }
    const [provider] = await connect({
      url: "http://app.test/forges",
      secret: "s3cret",
      fetch: mounted,
    })
    assert.equal((await provider.repos.get(repo)).description, "Widgets")
  })

  it("warns when the proxy runs an incompatible forges", async (t) => {
    const warn = t.mock.method(console, "warn", () => {})
    const runs = (version: string) => async (url: string, init?: RequestInit) => {
      const response = await fetch(url, init)
      return new URL(url).pathname === "/"
        ? Response.json({ ...v.parse(v.looseObject({}), await response.json()), forges: version })
        : response
    }
    for (const version of [FORGES_VERSION, "0.3.9"]) {
      await connect({ url: "http://proxy.test", secret: "s3cret", fetch: runs(version) })
    }
    assert.equal(warn.mock.callCount(), 0)
    await connect({ url: "http://proxy.test", secret: "s3cret", fetch: runs("0.4.0") })
    assert.match(
      String(warn.mock.calls[0].arguments[0]),
      /runs forges 0\.4\.0, but this client was built against/,
    )
  })

  it("rejects a wrong secret", async () => {
    await assert.rejects(remote("nope"), { status: 401 })
  })

  it("plugs into createForges", async () => {
    const forges = createForges(Object.values(await remote("s3cret")))
    assert.equal((await forges.for(repo)!.repos.get(repo)).description, "Widgets")
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
    const page = await fake.threads.list(repo, { perPage: 2, state: "all" }).page()
    assert.equal(page.items.length, 2)
    assert.ok(page.cursor)
  })

  it("returns file bytes as bytes", async () => {
    const { fake } = await remote("s3cret")
    const file = await fake.contents.getFile(repo, "logo.png")
    assert.deepEqual(file.content, new Uint8Array([0, 255, 1]))
  })

  it("writes file bytes as bytes", async () => {
    const { fake } = await remote("s3cret")
    const bytes = new Uint8Array([9, 0, 200])
    await fake.contents.commitFiles(repo, {
      branch: "main",
      message: "Add bytes",
      changes: [{ path: "data.bin", content: bytes }],
    })
    assert.deepEqual((await direct.contents.getFile(repo, "data.bin")).content, bytes)
  })

  it("streams job logs", async () => {
    const { fake } = await remote("s3cret")
    const [run] = (await fake.ci.runs(repo).page()).items
    const [job] = (await fake.ci.jobs(run.ref).page()).items
    assert.equal(await new Response(await fake.ci.log(job.ref)).text(), "ok\n")
  })

  it("resolves with nothing where the provider does", async () => {
    const { fake } = await remote("s3cret")
    assert.equal(await fake.releases.latest(repo), undefined)
  })

  it("writes", async () => {
    const { fake } = await remote("s3cret")
    const comment = await fake.threads.createComment(issue, "Over the wire")
    assert.equal(comment.body, "Over the wire")
    assert.ok(
      (await direct.threads.comments(issue).page()).items.some(
        (item) => item.body === "Over the wire",
      ),
    )
  })

  it("rebuilds forge errors with their class and fields", async () => {
    const { fake } = await remote("s3cret")
    direct.failNext(
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
    direct.failNext(
      "repos.get",
      new RateLimitedError("Slow", 429, "", { resetAt, secondary: true }),
    )
    await assert.rejects(fake.repos.get(repo), (error) => {
      assert.ok(error instanceof RateLimitedError)
      assert.deepEqual(error.resetAt, new Date(Math.floor(resetAt.getTime())))
      assert.equal(error.secondary, true)
      return true
    })
    direct.failNext("repos.get", new ForbiddenError("No", 403, "", "sso_required"))
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

  it("answers them only for the forges it has factories for", async () => {
    const only = async (factories: Parameters<typeof connect>[0]["factories"]) =>
      (await connect({ url: "http://proxy.test", secret: "s3cret", fetch, factories }))[1]
    assert.equal((await only([githubFactory])).webOrigin, "https://github.com")
    assert.equal((await only(undefined)).webOrigin, undefined)
    assert.equal(
      (await only([gitlabFactory])).parseUrl("https://github.com/acme/widgets"),
      undefined,
    )
  })
})

describe("remote event stream", () => {
  env({ FORGES_PROXY_SECRET: "s3cret" })

  it("follows events with their cursors, until aborted", async () => {
    const { fake } = await remote("s3cret")
    const controller = new AbortController()
    const items = fake.sources.stream({ signal: controller.signal })[Symbol.asyncIterator]()
    const next = items.next()
    await direct.threads.create(repo, { kind: "issue", title: "Streamed" })
    const { value } = await next
    assert.ok(value!.event.occurredAt instanceof Date)
    assert.equal(value!.cursor, direct.store.events.at(-1)!.id)
    controller.abort()
    assert.deepEqual(await items.next(), { done: true, value: undefined })
  })

  it("resumes from a cursor", async () => {
    const { fake } = await remote("s3cret")
    await direct.threads.create(repo, { kind: "issue", title: "Missed" })
    const [seen, missed] = direct.store.events.slice(-2)
    const controller = new AbortController()
    for await (const item of fake.sources.stream({ cursor: seen.id, signal: controller.signal })) {
      assert.equal(item.cursor, missed.id)
      controller.abort()
    }
  })

  it("throws StreamClosedError when the forge closes it", async () => {
    const { fake } = await remote("s3cret")
    const items = fake.sources.stream()[Symbol.asyncIterator]()
    const next = items.next()
    direct.offline()
    try {
      await assert.rejects(next, { name: "StreamClosedError" })
    } finally {
      direct.online()
    }
  })

  it("rejects for a forge without a stream", async () => {
    const { github } = await remote("s3cret")
    assert.equal(github.can("sources.stream"), false)
    await assert.rejects(
      github.sources.stream()[Symbol.asyncIterator]().next(),
      UnsupportedOperationError,
    )
  })
})

describe("remote provider of a public instance", () => {
  env({ FORGES_PROXY_PUBLIC: "1" })

  it("reports and rejects the verbs the proxy doesn't route", async () => {
    const { fake } = await remote()
    assert.equal(fake.can("repos.get"), true)
    assert.equal(fake.can("threads.createComment", "issue"), false)
    assert.equal(fake.support("users.me"), false)
    await assert.rejects(fake.threads.createComment(issue, "x"), UnsupportedOperationError)
    await assert.rejects(async () => {
      for await (const _ of fake.notifications.list()) {
        // unreachable
      }
    }, UnsupportedOperationError)
    await assert.rejects(fake.notifications.list().page(), UnsupportedOperationError)
  })
})
