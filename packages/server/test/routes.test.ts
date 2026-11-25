import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { describe, it } from "node:test"
import { createForges, RateLimitedError } from "forges"
import { fake } from "forges/fake"
import { encode } from "forges/wire"
import { createProxy, env } from "./support/proxy.ts"
import * as v from "valibot"

const factory = fake({
  seed: {
    repos: [{ repo: "acme/widgets", description: "Widgets" }],
    files: [{ repo: "acme/widgets", path: "README.md", content: "hi" }],
    threads: [
      { repo: "acme/widgets", kind: "issue", title: "Bug" },
      { repo: "acme/widgets", kind: "issue", title: "Feature" },
    ],
    runs: [{ repo: "acme/widgets", name: "ci", jobs: [{ name: "test", log: "ok\n" }] }],
  },
})
const forges = createForges([factory])
const app = createProxy(forges)

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
  call(`/fake/fake.test/${name}`, { args, headers })
const write = (name: string, args: unknown[], headers?: Record<string, string>) =>
  call(`/fake/fake.test/${name}`, {
    method: "POST",
    args,
    headers: { "content-type": "application/json", ...headers },
  })

async function errorOf(response: Response): Promise<{ name: string; message: string }> {
  return v.parse(
    v.object({ error: v.object({ name: v.string(), message: v.string() }) }),
    await response.json(),
  ).error
}

describe("configuration", () => {
  it("returns 503 ProxyError when neither access mode variable is set", async () => {
    const response = await read("repos.get", [repo])
    assert.equal(response.status, 503)
    assert.equal(response.headers.get("cache-control"), "no-store")
    assert.equal((await errorOf(response)).name, "ProxyError")
  })

  describe("with FORGES_PROXY_PREVIOUS_SECRET set without FORGES_PROXY_SECRET", () => {
    env({ FORGES_PROXY_PREVIOUS_SECRET: "old", FORGES_PROXY_PUBLIC: "1" })
    it("returns 503", async () => {
      assert.equal((await read("repos.get", [repo])).status, 503)
    })
  })

  describe("with both FORGES_PROXY_SECRET and FORGES_PROXY_PUBLIC set", () => {
    env({ FORGES_PROXY_SECRET: "s3cret", FORGES_PROXY_PUBLIC: "1" })
    it("returns 503", async () => {
      assert.equal((await read("repos.get", [repo])).status, 503)
    })
  })
})

describe("secret rotation", () => {
  env({ FORGES_PROXY_SECRET: "new", FORGES_PROXY_PREVIOUS_SECRET: "old" })

  it("accepts both the current and previous secrets and rejects other tokens", async () => {
    for (const [secret, status] of [
      ["new", 200],
      ["old", 200],
      ["nope", 401],
    ] as const) {
      const response = await read("repos.get", [repo], { authorization: `Bearer ${secret}` })
      assert.equal(response.status, status, secret)
    }
  })
})

describe("private mode", () => {
  env({ FORGES_PROXY_SECRET: "s3cret" })
  const authorization = { authorization: "Bearer s3cret" }

  it("rejects missing or invalid bearer tokens with 401", async () => {
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

  it("handles CORS preflights and includes CORS headers on error responses", async () => {
    const preflight = await call("/fake/fake.test/repos.get", {
      method: "OPTIONS",
      headers: {
        origin: "https://app.test",
        "access-control-request-method": "GET",
        "access-control-request-headers": "authorization",
      },
    })
    assert.equal(preflight.status, 204)
    assert.equal(preflight.headers.get("access-control-allow-origin"), "*")
    assert.equal(preflight.headers.get("access-control-allow-headers"), "authorization")
    const denied = await call("/_meta", { headers: { origin: "https://app.test" } })
    assert.equal(denied.status, 401)
    assert.equal(denied.headers.get("access-control-allow-origin"), "*")
    const unknown = await call("/fake/fake.test/repos.get/extra", {
      headers: { origin: "https://app.test", ...authorization },
    })
    assert.equal(unknown.status, 404)
    assert.equal(unknown.headers.get("access-control-allow-origin"), "*")
  })

  it("requires authentication on all routes except /, /_docs, /openapi.json, and POST /webhooks/:forge/:instance", async () => {
    const root = await call("/")
    assert.equal(root.status, 302)
    assert.equal(root.headers.get("location"), "_docs")
    assert.equal((await call("/_meta")).status, 401)
    assert.equal((await call("/_status")).status, 401)
    assert.equal((await call("/nope")).status, 401)
    assert.equal((await call("/_docs")).status, 200)
    assert.equal((await call("/openapi.json")).status, 200)
    assert.equal((await call("/_docsx")).status, 401)
    assert.equal((await call("/webhooks/fake/fake.test")).status, 401)
    assert.equal((await call("/webhooks/fake/fake.test/x", { method: "POST" })).status, 401)
  })

  it("marks read responses as private, no-store", async () => {
    const response = await read("repos.get", [repo], authorization)
    assert.equal(response.status, 200)
    assert.equal(response.headers.get("cache-control"), "private, no-store")
    assert.equal(response.headers.get("cdn-cache-control"), null)
    assert.equal(response.headers.get("etag"), null)
    assert.equal(
      v.parse(v.object({ description: v.string() }), await response.json()).description,
      "Widgets",
    )
  })

  it("routes write and account verbs", async () => {
    const response = await write("threads.createComment", [issue, "Thanks"], authorization)
    assert.equal(response.status, 200)
    assert.equal(v.parse(v.object({ body: v.string() }), await response.json()).body, "Thanks")
    assert.equal((await read("users.me", [], authorization)).status, 200)
  })

  it("includes all routed verbs and skipped provider configs in GET /_meta", async (t) => {
    process.env.FORGES_GITLAB_BASE_URL = "https://git.example"
    t.after(() => delete process.env.FORGES_GITLAB_BASE_URL)
    const body = v.parse(
      v.object({
        mode: v.string(),
        verbs: v.array(v.object({ name: v.string() })),
        skipped: v.array(v.unknown()),
      }),
      await (await call("/_meta", { headers: authorization })).json(),
    )
    assert.equal(body.mode, "private")
    assert.ok(body.verbs.some((verb) => verb.name === "threads.createComment"))
    const response = await call("/_meta", { headers: authorization })
    assert.equal(response.headers.get("cache-control"), "private, no-store")
    assert.equal(response.headers.get("etag"), null)
    assert.deepEqual(body.skipped, [
      { forge: "gitlab", suffix: "", reason: "needs TOKEN, or ENABLED for anonymous reads" },
    ])
  })
})

describe("public mode", () => {
  env({ FORGES_PROXY_PUBLIC: "1" })

  it("sets CDN cache headers on read responses", async () => {
    const response = await read("repos.get", [repo])
    assert.equal(response.status, 200)
    assert.equal(response.headers.get("cache-control"), "public, max-age=0, must-revalidate")
    assert.equal(
      response.headers.get("cdn-cache-control"),
      "public, max-age=60, stale-while-revalidate=600",
    )
    assert.ok(response.headers.get("cache-tag")!.split(",").includes("fake:fake.test"))
  })

  it("uses custom cdnHeaders when configured", async () => {
    const custom = createProxy(forges, {
      cdnHeaders: ({ cacheControl, tags }) => ({ "x-cdn": `${cacheControl}; ${tags.length}` }),
    })
    const url = `http://proxy.test/fake/fake.test/repos.get?args=${encodeURIComponent(JSON.stringify([repo]))}`
    const response = await custom.fetch(new Request(url))
    assert.equal(response.headers.get("x-cdn"), "public, max-age=60, stale-while-revalidate=600; 2")
    assert.equal(response.headers.get("cdn-cache-control"), null)
  })

  it("returns 304 Not Modified when If-None-Match matches the weak ETag", async () => {
    const etag = (await read("repos.get", [repo])).headers.get("etag")!
    assert.match(etag, /^W\/"[0-9a-f]{32}"$/)
    const revalidated = await read("repos.get", [repo], { "if-none-match": `"x", ${etag}` })
    assert.equal(revalidated.status, 304)
    assert.equal(revalidated.headers.get("etag"), etag)
    assert.ok(revalidated.headers.get("cdn-cache-control"))
    const other = await read("repos.get", [repo], { "if-none-match": 'W/"stale"' })
    assert.equal(other.status, 200)
  })

  it("blocks write and account verbs with 501 UnsupportedOperationError", async () => {
    const comments = () =>
      factory.store.repos.get("acme/widgets")!.threads.get("1")!.comments.length
    const before = comments()
    const blocked = await write("threads.createComment", [issue, "Thanks"])
    assert.equal(blocked.status, 501)
    assert.equal((await errorOf(blocked)).name, "UnsupportedOperationError")
    assert.equal((await read("users.me", [])).status, 501)
    assert.equal((await read("notifications.list", [])).status, 501)
    assert.equal(comments(), before)
  })

  it("blocks privileged read verbs with 501", async () => {
    assert.equal((await read("securityAlerts.list", [repo])).status, 501)
    assert.equal((await read("repos.collaborators", [repo])).status, 501)
  })

  it("lists only public read verbs and omits skipped provider diagnostics in GET /_meta", async () => {
    const body = v.parse(
      v.looseObject({ verbs: v.array(v.object({ write: v.boolean(), account: v.boolean() })) }),
      await (await call("/_meta")).json(),
    )
    assert.ok(body.verbs.length > 0)
    assert.ok(body.verbs.every((verb) => !verb.write && !verb.account))
    assert.equal("skipped" in body, false)
  })

  it("reports its forges version on verb responses, errors included", async () => {
    const { version } = v.parse(
      v.object({ version: v.string() }),
      JSON.parse(readFileSync(new URL(import.meta.resolve("forges/package.json")), "utf8")),
    )
    assert.equal((await read("repos.get", [repo])).headers.get("forges-version"), version)
    assert.equal((await read("users.me", [])).headers.get("forges-version"), version)
  })

  it("sets browser and CDN cache headers with ETag revalidation on GET /_meta", async () => {
    const response = await call("/_meta")
    assert.equal(response.headers.get("cache-control"), "public, max-age=60")
    assert.equal(
      response.headers.get("cdn-cache-control"),
      "public, max-age=60, stale-while-revalidate=600",
    )
    assert.equal(response.headers.get("cache-tag"), "fake:fake.test")
    const etag = response.headers.get("etag")!
    assert.match(etag, /^W\/"[0-9a-f]{32}"$/)
    const revalidated = await call("/_meta", { headers: { "if-none-match": etag } })
    assert.equal(revalidated.status, 304)
  })
})

describe("dispatch", () => {
  env({ FORGES_PROXY_SECRET: "s3cret" })
  const authorization = { authorization: "Bearer s3cret" }

  it("returns 404 for unknown verbs, excluded verbs, and unconfigured providers", async () => {
    for (const name of ["repos.nope", "installations.token", "threads.listPage"]) {
      const response = await read(name, [repo], authorization)
      assert.equal(response.status, 404, name)
      assert.equal((await errorOf(response)).name, "ProxyError")
    }
    const unconfigured = await call("/github/github.com/repos.get", {
      args: [repo],
      headers: authorization,
    })
    assert.equal(unconfigured.status, 404)
    assert.equal((await errorOf(unconfigured)).name, "UnknownForgeError")
  })

  it("returns 405 Method Not Allowed when called with the wrong HTTP method", async () => {
    const getWrite = await read("threads.createComment", [issue, "x"], authorization)
    assert.equal(getWrite.status, 405)
    assert.equal(getWrite.headers.get("allow"), "POST")
    assert.equal((await write("repos.get", [repo], authorization)).status, 405)
  })

  it("returns 400 when args is not a valid JSON array", async () => {
    for (const args of ["nope", '{"a":1}']) {
      const response = await call(`/fake/fake.test/repos.get?args=${encodeURIComponent(args)}`, {
        headers: authorization,
      })
      assert.equal(response.status, 400, args)
    }
    const repeated = `args=${encodeURIComponent(JSON.stringify([repo]))}`
    const response = await call(`/fake/fake.test/repos.get?${repeated}&${repeated}`, {
      headers: authorization,
    })
    assert.equal(response.status, 400)
  })

  it("returns 400 with the failing path when args fail schema validation", async () => {
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
    const since = await read("search.threads", [{ repo, since: "yesterday" }], authorization)
    assert.match((await errorOf(since)).message, /^args\/0\/since:/)
  })

  it("accepts null for omitted optional positional arguments", async () => {
    const response = await read("contents.getFile", [repo, "README.md", null], authorization)
    assert.equal(response.status, 200)
  })

  it("returns 400 when arguments contain a ref for another forge or instance", async () => {
    const github = { ...repo, forge: "github", instance: "github.com" }
    const cases: Array<[string, unknown[], string]> = [
      ["repos.get", [github], "args/0 names github on github.com"],
      ["repos.get", [{ ...repo, instance: "other.test" }], "args/0 names fake on other.test"],
      ["threads.get", [{ ...issue, repo: github }], "args/0/repo names github"],
      ["search.threads", [{ repo: github }], "args/0/repo names github"],
    ]
    for (const [name, args, message] of cases) {
      const response = await read(name, args, authorization)
      assert.equal(response.status, 400, message)
      assert.ok((await errorOf(response)).message.startsWith(message), message)
    }
  })

  it("encodes binary file content as base64 $bytes", async () => {
    const response = await read("contents.getFile", [repo, "README.md"], authorization)
    const file = v.parse(
      v.object({ encoding: v.string(), content: v.object({ $bytes: v.string() }) }),
      await response.json(),
    )
    assert.equal(file.encoding, "binary")
    assert.equal(Buffer.from(file.content.$bytes, "base64").toString(), "hi")
  })

  it("returns one page per listing request and advances with cursor", async () => {
    const page = async (cursor?: unknown) => {
      const response = await read(
        "threads.list",
        [repo, { perPage: 1, state: "all", ...(cursor ? { cursor } : {}) }],
        authorization,
      )
      assert.equal(response.status, 200)
      return v.parse(
        v.object({
          items: v.array(v.object({ title: v.string() })),
          cursor: v.optional(v.unknown()),
        }),
        await response.json(),
      )
    }
    const first = await page()
    assert.equal(first.items.length, 1)
    assert.ok(first.cursor)
    const second = await page(first.cursor)
    assert.notDeepEqual(second.items, first.items)
  })

  it("returns 204 No Content when a verb resolves to undefined", async () => {
    const response = await read("releases.latest", [repo], authorization)
    assert.equal(response.status, 204)
    assert.equal(await response.text(), "")
  })

  it("streams binary responses as application/octet-stream", async () => {
    const provider = forges.providers[0]
    const [run] = (await provider.ci.runs(repo).page()).items
    const [job] = (await provider.ci.jobs(run.ref).page()).items
    const response = await read("ci.log", [job.ref], authorization)
    assert.equal(response.headers.get("content-type"), "application/octet-stream")
    assert.equal(await response.text(), "ok\n")
  })

  it("decodes $date values in arguments into Date instances", async () => {
    const search = async (since: Date) => {
      const args = encode([{ repo, since }])
      assert.ok(Array.isArray(args))
      const response = await read("search.threads", args, authorization)
      assert.equal(response.status, 200)
      return v.parse(v.object({ items: v.array(v.unknown()) }), await response.json()).items.length
    }
    assert.equal(await search(new Date(0)), 2)
    assert.equal(await search(new Date(Date.now() + 86_400_000)), 0)
  })

  it("forwards the request AbortSignal into the verb's options", async (t) => {
    const get = t.mock.method(forges.providers[0].repos, "get")
    const controller = new AbortController()
    const url = new URL("/fake/fake.test/repos.get", "http://proxy.test")
    url.searchParams.set("args", JSON.stringify([repo]))
    await app.fetch(new Request(url, { headers: authorization, signal: controller.signal }))
    const { signal } = v.parse(
      v.object({ signal: v.instance(AbortSignal) }),
      get.mock.calls[0].arguments[1],
    )
    controller.abort()
    assert.equal(signal.aborted, true)
  })

  it("maps ForgeError instances to their corresponding HTTP status and error body", async () => {
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
