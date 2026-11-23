import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { createForges } from "forges"
import { fake } from "forges/fake"
import { createProxy, env } from "./support/proxy.ts"
import * as v from "valibot"

const app = createProxy(createForges([fake()]))

const Document = v.object({
  paths: v.record(v.string(), v.record(v.string(), v.any())),
  components: v.object({
    schemas: v.record(v.string(), v.unknown()),
    securitySchemes: v.optional(v.unknown()),
  }),
  security: v.optional(v.unknown()),
})
type Document = v.InferOutput<typeof Document>

async function document(): Promise<{ response: Response; doc: Document }> {
  const response = await app.fetch(new Request("http://proxy.test/openapi.json"))
  return { response, doc: v.parse(Document, await response.json()) }
}

describe("GET /openapi.json", () => {
  describe("on a public instance", () => {
    env({ FORGES_PROXY_PUBLIC: "1" })

    it("marks `raw` optional in model schemas because responses omit it by default", async () => {
      const { doc } = await document()
      assert.ok(JSON.stringify(doc.components.schemas.Repo).includes('"raw"'))
      assert.doesNotMatch(JSON.stringify(doc.components.schemas), /"required":\[[^\]]*"raw"/)
    })

    it("includes only routed read verbs and enumerates configured forges and instances", async () => {
      const { response, doc } = await document()
      assert.equal(response.headers.get("cache-control"), "public, max-age=300")
      assert.ok(doc.paths["/{forge}/{instance}/repos.get"]?.get)
      assert.equal(doc.paths["/{forge}/{instance}/threads.createComment"], undefined)
      assert.equal(doc.paths["/{forge}/{instance}/users.me"], undefined)
      const [forge, instance] = doc.paths["/{forge}/{instance}/repos.get"].parameters
      assert.deepEqual(forge.schema.enum, ["fake"])
      assert.deepEqual(instance.schema.enum, ["fake.test"])
      assert.equal(doc.security, undefined)
    })

    it("includes the sources.stream SSE route", async () => {
      const { doc } = await document()
      const stream = doc.paths["/{forge}/{instance}/sources.stream"]?.get
      assert.ok(stream?.responses[200].content["text/event-stream"])
    })

    it("defines read arguments as a JSON tuple in the `args` query parameter", async () => {
      const { doc } = await document()
      const { parameters } = doc.paths["/{forge}/{instance}/repos.get"].get
      const args = parameters.find((param: { name: string }) => param.name === "args")
      assert.equal(args.required, true)
      assert.equal(args.description, "`[ref, options?]`")
      const schema = args.content["application/json"].schema
      assert.deepEqual(
        schema.prefixItems.map((item: { title: string }) => item.title),
        ["ref", "options?"],
      )
      assert.deepEqual([schema.minItems, schema.maxItems], [1, 2])
    })

    it("documents binary streams, 204 responses, and default error responses", async () => {
      const { doc } = await document()
      const path = (verb: string) => doc.paths[`/{forge}/{instance}/${verb}`].get.responses
      assert.ok(path("ci.log")[200].content["application/octet-stream"])
      assert.equal(path("ci.log")[200].content["application/json"], undefined)
      assert.ok(path("releases.latest")[204])
      assert.ok(path("releases.latest")[200].content["application/json"])
      assert.ok(path("repos.get").default)
    })

    it("resolves all component schema $refs", async () => {
      const { doc } = await document()
      for (const [, ref] of JSON.stringify(doc).matchAll(
        /"\$ref":"#\/components\/schemas\/([^"]+)"/g,
      )) {
        assert.ok(doc.components.schemas[ref], ref)
      }
    })
  })

  describe("on a private instance", () => {
    env({ FORGES_PROXY_SECRET: "s3cret" })

    it("documents write verbs as POST endpoints with bearer security", async () => {
      const { response, doc } = await document()
      assert.equal(response.headers.get("cache-control"), "private, no-store")
      const comment = doc.paths["/{forge}/{instance}/threads.createComment"]
      assert.ok(comment.post.requestBody.content["application/json"].schema.properties.args)
      assert.equal(comment.get, undefined)
      assert.ok(doc.components.securitySchemes)
      assert.deepEqual(doc.security, [{ secret: [] }])
      assert.deepEqual(
        Object.keys(doc.paths["/{forge}/{instance}/threads.deleteComment"].post.responses),
        ["204", "default"],
      )
    })
  })
})
