import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { createForges } from "forges"
import { fake } from "forges/fake"
import { createProxy, env } from "./support/proxy.ts"

const forge = fake({ seed: { repos: [{ repo: "acme/widgets" }] } })
const unsupported = fake({ instance: "other.test", support: { "sources.stream": false } })
const app = createProxy(createForges([forge, unsupported]))
const repo = { forge: "fake", instance: "fake.test", owner: "acme", name: "widgets" }

/** Opens the stream and reads it one server-sent message at a time. */
async function open(headers: Record<string, string> = {}, path = "/fake/fake.test/sources.stream") {
  const response = await app.fetch(new Request(new URL(path, "http://proxy.test"), { headers }))
  const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ""
  async function next(): Promise<Record<string, string>> {
    while (!buffer.includes("\n\n")) {
      const { value, done } = await reader.read()
      if (done) throw new Error("The stream ended")
      buffer += value
    }
    const [message, ...rest] = buffer.split("\n\n")
    buffer = rest.join("\n\n")
    return Object.fromEntries(
      message
        .split("\n")
        .map((line) => [line.slice(0, line.indexOf(":")), line.slice(line.indexOf(":") + 2)]),
    )
  }
  return { response, next, close: () => reader.cancel() }
}

describe("GET /:forge/:instance/sources.stream", () => {
  env({ FORGES_PROXY_PUBLIC: "1" })

  it("sends each event as it happens, with its cursor as the id", async () => {
    const stream = await open()
    assert.equal(stream.response.headers.get("content-type"), "text/event-stream")
    assert.match(stream.response.headers.get("cache-control") ?? "", /no-store|no-cache/)
    const thread = await forge.threads.create(repo, { kind: "issue", title: "Bug" })
    const message = await stream.next()
    assert.equal(message.id, forge.store.events.at(-1)!.id)
    assert.equal(JSON.parse(message.data).thread.number, thread.ref.number)
    await stream.close()
  })

  it("resumes after Last-Event-ID", async () => {
    await forge.threads.create(repo, { kind: "issue", title: "First" })
    await forge.threads.create(repo, { kind: "issue", title: "Second" })
    const [first, second] = forge.store.events.slice(-2)
    const stream = await open({ "last-event-id": first.id })
    assert.equal((await stream.next()).id, second.id)
    await stream.close()
  })

  it("ends with an error event when the forge closes the stream", async () => {
    const stream = await open()
    forge.offline()
    try {
      const message = await stream.next()
      assert.equal(message.event, "error")
      assert.equal(JSON.parse(message.data).error.name, "StreamClosedError")
    } finally {
      forge.online()
    }
  })

  it("answers 501 for a provider without a stream", async () => {
    const response = await app.fetch(
      new Request("http://proxy.test/fake/other.test/sources.stream"),
    )
    assert.equal(response.status, 501)
  })
})
