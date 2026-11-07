import { cacheApiStore, createServer } from "@forges-proxy/server"

export default createServer({
  upstreamStore: cacheApiStore(() => caches.open("upstream")),
})
