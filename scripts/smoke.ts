/**
 * Checks a running proxy end to end, through the client: `node scripts/smoke.ts <url> [secret]`. Expects GitHub to be
 * configured, since it reads one public repository.
 */
import assert from "node:assert/strict"
import process from "node:process"
import { connect } from "@forges-proxy/client"
import { createForges } from "forges"

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
  const index = (await response.json()) as { forges: string; providers: unknown[] }
  assert.match(index.forges, /^\d+\.\d+\.\d+/)
  assert.ok(index.providers.length > 0)
})
await check("docs and OpenAPI", async () => {
  const docs = await fetch(new URL("docs", base))
  assert.equal(docs.status, 200)
  assert.match(await docs.text(), /data-url="openapi.json"/)
  const openapi = (await (await fetch(new URL("openapi.json", base))).json()) as {
    servers: Array<{ url: string }>
  }
  assert.equal(openapi.servers[0]!.url, ".")
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
await check("a read through the client", async () => {
  const forges = createForges(await connect({ url: base, secret }))
  const ref = { forge: "github", instance: "github.com", owner: "danielroe", name: "forges" }
  const repo = await forges.for(ref)!.repos.get(ref)
  assert.equal(repo.ref.name, "forges")
})
if (secret) {
  await check("a write's body reaches the proxy", async () => {
    // Refused before any upstream request, with a message only a parsed body can produce.
    const repo = { forge: "gitlab", instance: "gitlab.com", owner: "a", name: "b" }
    const thread = { ...repo, repo, kind: "issue", number: "1" }
    const response = await fetch(new URL("github/github.com/threads.createComment", base), {
      method: "POST",
      headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
      body: JSON.stringify({ args: [thread, "hi"] }),
    })
    assert.equal(response.status, 400)
    assert.match(
      ((await response.json()) as { error: { message: string } }).error.message,
      /names gitlab/,
    )
  })
}
