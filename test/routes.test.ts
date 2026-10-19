import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { createForges, RateLimitedError } from "forges"
import { fake } from "forges/fake"
import { createProxy, env } from "./support/proxy.ts"

const factory = fake({
  seed: {
    repos: [{ repo: "acme/widgets", description: "Widgets" }],
    files: [{ repo: "acme/widgets", path: "README.md", content: "hi" }],
    threads: [{ repo: "acme/widgets", kind: "issue", title: "Bug" }],
    runs: [{ repo: "acme/widgets", name: "ci", jobs: [{ name: "test", log: "ok\n" }] }],
  },
})
const forges = createForges([factory])
const app = await createProxy(forges)

const repo = { forge: "fake", instance: "fake.test", owner: "acme", name: "widgets" }
const issue = { forge: "fake", instance: "fake.test", repo, kind: "issue", number: "1" }

function call(path: string, init: RequestInit & { args?: unknown[] } = {}): Promise<Response> {
  const { args, ...rest } = init
  const url = new URL(path, "http://proxy.test")
  if (args && rest.method !== "POST") {
    url.searchParams.set("args", JSON.stringify(args))
  }
  return Promise.resolve(
    app.fetch(
      new Request(url, {
        ...rest,
        ...(args && rest.method === "POST" ? { body: JSON.stringify({ args }) } : {}),
      }),
    ),
  )
}

const read = (name: string, args: unknown[], headers?: HeadersInit) =>
  call(`/v1/fake/fake.test/${name}`, { args, headers })
const write = (name: string, args: unknown[], headers?: HeadersInit) =>
  call(`/v1/fake/fake.test/${name}`, {
    method: "POST",
    args,
    headers: { "content-type": "application/json", ...headers },
  })

async function errorOf(response: Response): Promise<{ name: string; message: string }> {
  return ((await response.json()) as { error: { name: string; message: string } }).error
}

describe("configuration", () => {
  it("refuses to serve without an access mode", async () => {
    assert.equal((await read("repos.get", [repo])).status, 503)
  })

  describe("with both a secret and public mode", () => {
    env({ FORGES_PROXY_SECRET: "s3cret", FORGES_PROXY_PUBLIC: "1" })
    it("refuses to serve", async () => {
      assert.equal((await read("repos.get", [repo])).status, 503)
    })
  })
})

describe("private mode", () => {
  env({ FORGES_PROXY_SECRET: "s3cret" })
  const authorization = { authorization: "Bearer s3cret" }

  it("rejects a missing or wrong secret", async () => {
    for (const headers of [
      {},
      { authorization: "Bearer nope" },
      { authorization: "s3cret" },
    ] as HeadersInit[]) {
      const response = await read("repos.get", [repo], headers)
      assert.equal(response.status, 401)
      assert.equal(response.headers.get("www-authenticate"), "Bearer")
    }
  })

  it("serves reads uncached", async () => {
    const response = await read("repos.get", [repo], authorization)
    assert.equal(response.status, 200)
    assert.equal(response.headers.get("cache-control"), "private, no-store")
    assert.equal(response.headers.get("cdn-cache-control"), null)
    assert.equal(((await response.json()) as { description: string }).description, "Widgets")
  })

  it("routes writes and account verbs", async () => {
    const response = await write("threads.comment", [issue, "Thanks"], authorization)
    assert.equal(response.status, 200)
    assert.equal(((await response.json()) as { body: string }).body, "Thanks")
    assert.equal((await read("users.me", [], authorization)).status, 200)
  })

  it("lists every verb and the skipped env sets", async () => {
    const body = (await (await call("/v1", { headers: authorization })).json()) as {
      mode: string
      verbs: Array<{ name: string }>
      skipped: unknown[]
    }
    assert.equal(body.mode, "private")
    assert.ok(body.verbs.some((verb) => verb.name === "threads.comment"))
    assert.deepEqual(body.skipped, [{ forge: "GITLAB", suffix: "", reason: "needs TOKEN" }])
  })
})

describe("public mode", () => {
  env({ FORGES_PROXY_PUBLIC: "1" })

  it("serves reads with CDN cache headers", async () => {
    const response = await read("repos.get", [repo])
    assert.equal(response.status, 200)
    assert.equal(response.headers.get("cache-control"), "public, max-age=0, must-revalidate")
    assert.equal(
      response.headers.get("cdn-cache-control"),
      "public, max-age=60, stale-while-revalidate=600",
    )
    assert.equal(
      response.headers.get("netlify-cdn-cache-control"),
      "public, max-age=60, stale-while-revalidate=600, durable",
    )
  })

  it("does not route writes or account verbs", async () => {
    const comments = () =>
      factory.store.repos.get("acme/widgets")!.threads.get("1")!.comments.length
    const before = comments()
    assert.equal((await write("threads.comment", [issue, "Thanks"])).status, 404)
    assert.equal((await read("users.me", [])).status, 404)
    assert.equal((await read("notifications.listPage", [])).status, 404)
    assert.equal(comments(), before)
  })

  it("lists only public verbs and hides the skipped env sets", async () => {
    const body = (await (await call("/v1")).json()) as {
      verbs: Array<{ write: boolean; account: boolean }>
    }
    assert.ok(body.verbs.length > 0)
    assert.ok(body.verbs.every((verb) => !verb.write && !verb.account))
    assert.equal("skipped" in body, false)
  })
})

describe("dispatch", () => {
  env({ FORGES_PROXY_SECRET: "s3cret" })
  const authorization = { authorization: "Bearer s3cret" }

  it("404s for unknown, excluded and iterable verbs, and unknown providers", async () => {
    for (const name of ["repos.nope", "installations.token", "threads.list"]) {
      const response = await read(name, [repo], authorization)
      assert.equal(response.status, 404, name)
      assert.equal((await errorOf(response)).name, "ProxyError")
    }
    assert.equal(
      (await call("/v1/github/github.com/repos.get", { args: [repo], headers: authorization }))
        .status,
      404,
    )
  })

  it("405s for the wrong method", async () => {
    const getWrite = await read("threads.comment", [issue, "x"], authorization)
    assert.equal(getWrite.status, 405)
    assert.equal(getWrite.headers.get("allow"), "POST")
    assert.equal((await write("repos.get", [repo], authorization)).status, 405)
  })

  it("400s for args that are not a JSON array", async () => {
    for (const args of ["nope", '{"a":1}']) {
      const response = await call(`/v1/fake/fake.test/repos.get?args=${encodeURIComponent(args)}`, {
        headers: authorization,
      })
      assert.equal(response.status, 400, args)
    }
  })

  it("400s for args that don't fit the verb's signature, naming where", async () => {
    const cases: Array<[unknown[], string]> = [
      [[], "args: Array has too few items"],
      [[{ ...repo, owner: 3 }], "args/0/owner:"],
      [[repo, {}, {}], "args: Array has too many items"],
    ]
    for (const [args, message] of cases) {
      const response = await read("repos.get", args, authorization)
      assert.equal(response.status, 400)
      assert.ok((await errorOf(response)).message.startsWith(message), message)
    }
    const since = await read("search.threadsPage", [{ repo, since: "yesterday" }], authorization)
    assert.match((await errorOf(since)).message, /^args\/0\/since: .*date-time/)
  })

  it("takes null for a skipped optional argument", async () => {
    const response = await read("contents.file", [repo, "README.md", null], authorization)
    assert.equal(response.status, 200)
  })

  it("400s for a ref to another forge", async () => {
    const response = await read(
      "repos.get",
      [{ ...repo, forge: "github", instance: "github.com" }],
      authorization,
    )
    assert.equal(response.status, 400)
  })

  it("sends file bytes tagged as base64", async () => {
    const response = await read("contents.file", [repo, "README.md"], authorization)
    const file = (await response.json()) as { encoding: string; content: { $bytes: string } }
    assert.equal(file.encoding, "binary")
    assert.equal(Buffer.from(file.content.$bytes, "base64").toString(), "hi")
  })

  it("answers 204 for a verb that resolves with nothing", async () => {
    const response = await read("releases.latest", [repo], authorization)
    assert.equal(response.status, 204)
    assert.equal(await response.text(), "")
  })

  it("streams job logs", async () => {
    const provider = forges.providers[0]!
    const [run] = (await provider.ci.runsPage(repo)).items
    const [job] = (await provider.ci.jobsPage(run!.ref)).items
    const response = await read("ci.log", [job!.ref], authorization)
    assert.equal(response.headers.get("content-type"), "application/octet-stream")
    assert.equal(await response.text(), "ok\n")
  })

  it("revives dates in arguments", async () => {
    // The fake calls `since.getTime()`, so a string left unrevived would fail the request.
    const search = async (since: Date) => {
      const response = await read(
        "search.threadsPage",
        [{ repo, since: since.toISOString() }],
        authorization,
      )
      assert.equal(response.status, 200)
      return ((await response.json()) as { items: unknown[] }).items.length
    }
    assert.equal(await search(new Date(0)), 1)
    assert.equal(await search(new Date(Date.now() + 86_400_000)), 0)
  })

  it("passes the request's signal to the verb", async (t) => {
    const get = t.mock.method(forges.providers[0]!.repos, "get")
    const controller = new AbortController()
    const url = new URL("/v1/fake/fake.test/repos.get", "http://proxy.test")
    url.searchParams.set("args", JSON.stringify([repo]))
    await app.fetch(new Request(url, { headers: authorization, signal: controller.signal }))
    const { signal } = get.mock.calls[0]!.arguments[1] as { signal: AbortSignal }
    controller.abort()
    assert.equal(signal.aborted, true)
  })

  it("maps forge errors", async () => {
    factory.failNext(
      "repos.get",
      new RateLimitedError("Slow down", 429, "", {
        forge: "fake",
        resetAt: new Date(Date.now() + 10_000),
      }),
    )
    const response = await read("repos.get", [repo], authorization)
    assert.equal(response.status, 429)
    assert.ok(response.headers.get("retry-after"))
    assert.equal((await errorOf(response)).name, "RateLimitedError")
  })
})
