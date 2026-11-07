import { cacheApiStore, createServer } from "@forges-proxy/server"

// `nodejs_compat` fills `process.env` from the Worker's vars and secrets, which the server reads by default.
export default createServer({
  upstreamStore: cacheApiStore(() => caches.open("upstream")),
})
