import server from "@forges-proxy/server"
import { defineHandler } from "nitro"

// The proxy answers at its own root, so it sees the path without the prefix.
export default defineHandler((event) => {
  const url = new URL(event.req.url)
  url.pathname = url.pathname.slice("/forges".length) || "/"
  return server.fetch(new Request(url, event.req))
})
