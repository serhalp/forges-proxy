import { createServer } from "@forges-proxy/server"
import { defineHandler } from "nitro"

const server = createServer({ anonymousForges: true })

// Strip the `/forges` mount prefix before forwarding the request to the proxy.
export default defineHandler((event) => {
  const url = new URL(event.req.url)
  url.pathname = url.pathname.slice("/forges".length) || "/"
  return server.fetch(new Request(url, event.req))
})
