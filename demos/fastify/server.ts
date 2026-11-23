import type { IncomingMessage, ServerResponse } from "node:http"
import process from "node:process"
import { createServer } from "@forges-proxy/server"
import Fastify from "fastify"
import { toNodeHandler } from "srvx/node"

// `srvx` types the handler over both HTTP/1 and HTTP/2; narrow to HTTP/1 for Fastify.
// oxlint-disable-next-line typescript/no-unsafe-type-assertion
const proxy = toNodeHandler(createServer({ anonymousForges: true }).fetch) as (
  req: IncomingMessage,
  res: ServerResponse,
) => unknown
const app = Fastify()
app.get("/", async () => "An app with a forges proxy at /forges/")
await app.register(
  async (scope) => {
    // Leave the request stream unconsumed so the proxy can read request bodies directly.
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
