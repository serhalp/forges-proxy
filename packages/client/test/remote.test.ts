import assert from "node:assert/strict"
import { describe, it } from "node:test"
import type { ForgeProvider } from "forges"
import {
  createForges,
  ForbiddenError,
  github as githubForge,
  NotFoundError,
  RateLimitedError,
  UnsupportedOperationError,
} from "forges"
import { decode } from "forges/wire"
import { fake as fakeForge } from "forges/fake"
import { github as githubFactory } from "forges/github"
import { gitlab as gitlabFactory } from "forges/gitlab"
import { allFactories } from "../src/all.ts"
import { discoverProviders, fetchProxyIndex } from "../src/remote.ts"
import { FORGES_VERSION } from "../src/version.ts"
import { serialize } from "../../server/src/wire.ts"
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
// Propagate `init.signal` abort to in-process `app.fetch` calls and response streams to match real `fetch`.
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

/** Round-trips a direct provider result through the server's wire serializer for comparison. */
const overTheWire = <T>(value: T): T =>
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  decode(JSON.parse(serialize(value, { raw: false }))) as T

async function remote(secret?: string): Promise<{ fake: ForgeProvider; github: ForgeProvider }> {
  const [fakeProvider, githubProvider] = await discoverProviders({
    url: "http://proxy.test",
    secret,
    fetch,
    factories: allFactories,
  })
  return { fake: fakeProvider, github: githubProvider }
}

describe("discoverProviders", () => {
  env({ FORGES_PROXY_SECRET: "s3cret" })

  it("returns one ForgeProvider per provider configured on the proxy", async () => {
    const { fake, github } = await remote("s3cret")
    assert.deepEqual([fake.forge, fake.instance], ["fake", "fake.test"])
    assert.deepEqual(fake.capabilities, overTheWire(direct.capabilities))
    assert.equal(github.forge, "github")
  })

  it("resolves requests against a proxy mounted under a path prefix", async () => {
    const mounted = async (url: string, init?: RequestInit) => {
      const { pathname, search } = new URL(url)
      assert.match(pathname, /^\/forges\//)
      return fetch(`http://proxy.test${pathname.slice("/forges".length)}${search}`, init)
    }
    const [provider] = await discoverProviders({
      url: "http://app.test/forges",
      secret: "s3cret",
      fetch: mounted,
    })
    assert.equal((await provider.repos.get(repo)).description, "Widgets")
  })

  it("throws when the proxy reports an incompatible forges version", async () => {
    const runs = (version: string) => async (url: string, init?: RequestInit) => {
      const response = await fetch(url, init)
      return new URL(url).pathname === "/"
        ? Response.json({ ...v.parse(v.looseObject({}), await response.json()), forges: version })
        : response
    }
    const [major, minor] = FORGES_VERSION.split(".")
    for (const version of [FORGES_VERSION, `${major}.${minor}.99`]) {
      await discoverProviders({ url: "http://proxy.test", secret: "s3cret", fetch: runs(version) })
    }
    const next = `${major}.${Number(minor) + 1}.0`
    await assert.rejects(
      discoverProviders({ url: "http://proxy.test", secret: "s3cret", fetch: runs(next) }),
      new RegExp(`runs forges ${next.replaceAll(".", "\\.")}, but this client was built against`),
    )
  })

  it("rejects with 401 when given an invalid proxy secret", async () => {
    await assert.rejects(remote("nope"), { status: 401 })
  })

  it("uses a pre-fetched index without requesting GET /", async () => {
    const index = await fetchProxyIndex({ url: "http://proxy.test", secret: "s3cret", fetch })
    const requested: string[] = []
    const counting = (url: string, init?: RequestInit) => {
      requested.push(new URL(url).pathname)
      return fetch(url, init)
    }
    const options = { url: "http://proxy.test", secret: "s3cret", fetch: counting }
    const [provider] = await discoverProviders({
      ...options,
      index: structuredClone(index),
    })
    assert.equal((await provider.repos.get(repo)).description, "Widgets")
    assert.deepEqual(requested, ["/fake/fake.test/repos.get"])
  })

  it("aborts requests that exceed the configured timeout", async () => {
    const stalls = (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason))
      })
    await assert.rejects(
      discoverProviders({ url: "http://proxy.test", fetch: stalls, timeout: 10 }),
      { name: "TimeoutError" },
    )
  })

  it("integrates with createForges()", async () => {
    const forges = createForges(Object.values(await remote("s3cret")))
    assert.equal((await forges.for(repo)!.repos.get(repo)).description, "Widgets")
  })

  it("supports cross-provider registry listings over remote providers", async () => {
    const forges = createForges([(await remote("s3cret")).fake])
    const threads = await Array.fromAsync(forges.search.threads({ repo }))
    const titles = threads.map((thread) => thread.title)
    assert.deepEqual(titles.toSorted(), ["One", "Three", "Two"])
  })
})

describe("remote provider", () => {
  env({ FORGES_PROXY_SECRET: "s3cret" })

  it("returns normalized models with decoded Date fields", async () => {
    const { fake } = await remote("s3cret")
    const repoRead = await fake.repos.get(repo)
    assert.deepEqual(repoRead, overTheWire(await direct.repos.get(repo)))
    assert.ok((await fake.threads.get(issue)).createdAt instanceof Date)
  })

  it("paginates listings via async iteration and .page()", async () => {
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

  it("decodes binary file responses into Uint8Array", async () => {
    const { fake } = await remote("s3cret")
    const file = await fake.contents.getFile(repo, "logo.png")
    assert.deepEqual(file.content, new Uint8Array([0, 255, 1]))
  })

  it("encodes Uint8Array arguments when writing files", async () => {
    const { fake } = await remote("s3cret")
    const bytes = new Uint8Array([9, 0, 200])
    await fake.contents.commitFiles(repo, {
      branch: "main",
      message: "Add bytes",
      changes: [{ path: "data.bin", content: bytes }],
    })
    assert.deepEqual((await direct.contents.getFile(repo, "data.bin")).content, bytes)
  })

  it("streams binary job logs", async () => {
    const { fake } = await remote("s3cret")
    const [run] = (await fake.ci.runs(repo).page()).items
    const [job] = (await fake.ci.jobs(run.ref).page()).items
    assert.equal(await new Response(await fake.ci.log(job.ref)).text(), "ok\n")
  })

  it("resolves to undefined on 204 No Content responses", async () => {
    const { fake } = await remote("s3cret")
    assert.equal(await fake.releases.latest(repo), undefined)
  })

  it("executes write verbs via POST", async () => {
    const { fake } = await remote("s3cret")
    const comment = await fake.threads.createComment(issue, "Over the wire")
    assert.equal(comment.body, "Over the wire")
    assert.ok(
      (await direct.threads.comments(issue).page()).items.some(
        (item) => item.body === "Over the wire",
      ),
    )
  })

  it("reconstructs ForgeError subclasses with their metadata fields", async () => {
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

  it("propagates caller AbortSignal to fetch", async () => {
    const { fake } = await remote("s3cret")
    await assert.rejects(fake.repos.get(repo, { signal: AbortSignal.abort() }), {
      name: "AbortError",
    })
  })

  it("runs synchronous helper methods locally when factories are provided", async () => {
    const { github } = await remote("s3cret")
    const ref = { forge: "github", instance: "github.com", owner: "acme", name: "widgets" }
    assert.equal(github.urlFor({ repo: ref }), "https://github.com/acme/widgets")
    assert.equal(github.parseUrl("https://github.com/acme/widgets")?.repo?.name, "widgets")
    assert.equal(github.webOrigin, "https://github.com")
  })

  it("returns undefined from synchronous helpers for forges without a provided factory", async () => {
    const only = async (factories: Parameters<typeof discoverProviders>[0]["factories"]) =>
      (await discoverProviders({ url: "http://proxy.test", secret: "s3cret", fetch, factories }))[1]
    assert.equal((await only([githubFactory])).webOrigin, "https://github.com")
    assert.equal((await only(undefined)).webOrigin, undefined)
    assert.equal(
      (await only([gitlabFactory])).parseUrl("https://github.com/acme/widgets"),
      undefined,
    )
  })
})

describe("remote provider state", () => {
  env({ FORGES_PROXY_SECRET: "s3cret" })

  it("updates rateLimits() from the latest verb response header", async () => {
    const { fake } = await remote("s3cret")
    assert.deepEqual(fake.rateLimits(), [])
    direct.setRateLimit({ limit: 10 })
    try {
      await fake.repos.get(repo)
      assert.equal(fake.rateLimits()[0]?.limit, 10)
    } finally {
      direct.setRateLimit(undefined)
    }
  })

  it("updates capabilities when refreshCapabilities() is called", async () => {
    let reads = 0
    const refining = async (url: string, init?: RequestInit) => {
      const response = await fetch(url, init)
      if (new URL(url).pathname !== "/" || ++reads === 1) return response
      const body = v.parse(
        v.looseObject({ providers: v.array(v.looseObject({ capabilities: v.looseObject({}) })) }),
        await response.json(),
      )
      return Response.json({
        ...body,
        providers: body.providers.map((entry) => ({
          ...entry,
          capabilities: { ...entry.capabilities, sources: { stream: false } },
        })),
      })
    }
    const [fake] = await discoverProviders({
      url: "http://proxy.test",
      secret: "s3cret",
      fetch: refining,
    })
    assert.equal(fake.can("sources.stream"), true)
    const refreshed = await fake.refreshCapabilities()
    assert.equal(refreshed.sources.stream, false)
    assert.equal(fake.capabilities.sources.stream, false)
    assert.equal(fake.can("sources.stream"), false)
  })
})

describe("remote event stream", () => {
  env({ FORGES_PROXY_SECRET: "s3cret" })

  it("yields streamed events and their cursors until aborted", async () => {
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

  it("resumes streaming from a provided cursor", async () => {
    const { fake } = await remote("s3cret")
    await direct.threads.create(repo, { kind: "issue", title: "Missed" })
    const [seen, missed] = direct.store.events.slice(-2)
    const controller = new AbortController()
    for await (const item of fake.sources.stream({ cursor: seen.id, signal: controller.signal })) {
      assert.equal(item.cursor, missed.id)
      controller.abort()
    }
  })

  it("throws StreamClosedError when the upstream stream closes", async () => {
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

  it("rejects with UnsupportedOperationError when the forge does not support streaming", async () => {
    const { github } = await remote("s3cret")
    assert.equal(github.can("sources.stream"), false)
    await assert.rejects(
      github.sources.stream()[Symbol.asyncIterator]().next(),
      UnsupportedOperationError,
    )
  })
})

describe("remote provider against a public instance", () => {
  env({ FORGES_PROXY_PUBLIC: "1" })

  it("reports false from can()/support() and rejects unrouted verbs with UnsupportedOperationError", async () => {
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
