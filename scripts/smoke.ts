/**
 * End-to-end smoke test for a running proxy deployment (`node scripts/smoke.ts <url> [secret]`).
 * Requires a `github:github.com` provider to be configured on the target deployment.
 */
import assert from "node:assert/strict"
import process from "node:process"
import { connect } from "@forges-proxy/client"
import { createForges } from "forges"
import * as v from "valibot"

const [url, secret] = process.argv.slice(2)
if (!url) {
  console.error("Usage: node scripts/smoke.ts <url> [secret]")
  process.exit(2)
}
const base = url.endsWith("/") ? url : `${url}/`

const check = async (name: string, fn: () => Promise<void>) => {
  await fn()
  console.log(`ok  ${name}`)
}

await check("index", async () => {
  const response = await fetch(
    base,
    secret ? { headers: { authorization: `Bearer ${secret}` } } : {},
  )
  assert.equal(response.status, 200)
  const index = v.parse(
    v.object({ forges: v.string(), providers: v.array(v.unknown()) }),
    await response.json(),
  )
  assert.match(index.forges, /^\d+\.\d+\.\d+/)
  assert.ok(index.providers.length > 0)
})
await check("docs and OpenAPI", async () => {
  const docs = await fetch(new URL("docs", base))
  assert.equal(docs.status, 200)
  assert.match(await docs.text(), /data-url="openapi.json"/)
  const openapi = v.parse(
    v.object({ servers: v.array(v.object({ url: v.string() })) }),
    await (await fetch(new URL("openapi.json", base))).json(),
  )
  assert.equal(openapi.servers[0].url, ".")
})
await check("CORS preflight", async () => {
  const response = await fetch(new URL("github/github.com/repos.get", base), {
    method: "OPTIONS",
    headers: {
      origin: "https://app.test",
      "access-control-request-method": "GET",
      "access-control-request-headers": "authorization",
    },
  })
  assert.equal(response.status, 204)
  assert.equal(response.headers.get("access-control-allow-origin"), "*")
})
await check("client read", async () => {
  const forges = createForges(await connect({ url: base, secret }))
  const ref = { forge: "github", instance: "github.com", owner: "danielroe", name: "forges" }
  const repo = await forges.for(ref)!.repos.get(ref)
  assert.equal(repo.ref.name, "forges")
})
if (secret) {
  await check("POST request body parsing", async () => {
    // Pass a mismatched forge ref in the body so the proxy rejects it with 400 before making an upstream call.
    const repo = { forge: "gitlab", instance: "gitlab.com", owner: "a", name: "b" }
    const thread = { ...repo, repo, kind: "issue", number: "1" }
    const response = await fetch(new URL("github/github.com/threads.createComment", base), {
      method: "POST",
      headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
      body: JSON.stringify({ args: [thread, "hi"] }),
    })
    assert.equal(response.status, 400)
    assert.match(
      v.parse(v.object({ error: v.object({ message: v.string() }) }), await response.json()).error
        .message,
      /names gitlab/,
    )
  })
}
