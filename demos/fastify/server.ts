import type { IncomingMessage, ServerResponse } from "node:http"
import process from "node:process"
import server from "@forges-proxy/server"
import Fastify from "fastify"
import { toNodeHandler } from "srvx/node"

// srvx types it for HTTP/1 and HTTP/2 at once; Fastify here is HTTP/1.
const proxy = toNodeHandler(server.fetch) as (req: IncomingMessage, res: ServerResponse) => unknown
const app = Fastify()
app.get("/", async () => "An app with a forges proxy at /forges/")
await app.register(
  async (scope) => {
    // The proxy reads request bodies itself, so Fastify must leave them unread.
    scope.removeAllContentTypeParsers()
    scope.addContentTypeParser("*", (_request, _payload, done) => done(null))
    scope.all("/*", (request, reply) => {
      reply.hijack()
      request.raw.url = request.raw.url!.slice("/forges".length) || "/"
      return proxy(request.raw, reply.raw)
    })
  },
  { prefix: "/forges" },
)

await app.listen({ port: Number(process.env.PORT ?? 3000) })
