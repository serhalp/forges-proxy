import process from "node:process"
import { createServer } from "@forges-proxy/server"
import { Hono } from "hono"
import { serve } from "srvx"

const app = new Hono()
app.get("/", (c) => c.text("An app with a forges proxy at /forges/"))
// `app.mount()` strips the `/forges` prefix before passing the request to the proxy.
app.mount("/forges", createServer({ anonymousForges: true }).fetch)

serve({ fetch: app.fetch, port: Number(process.env.PORT ?? 3000) })
