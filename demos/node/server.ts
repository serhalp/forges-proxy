import process from "node:process"
import { createServer } from "@forges-proxy/server"
import { serve } from "srvx"

serve({
  fetch: createServer({ anonymousForges: true }).fetch,
  port: Number(process.env.PORT ?? 3000),
})
