import process from "node:process"
import server from "@forges-proxy/server"
import { serve } from "srvx"

serve({ fetch: server.fetch, port: Number(process.env.PORT ?? 3000) })
