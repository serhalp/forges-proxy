import { cacheApiStore, createServer } from "@forges-proxy/server"

export default createServer({
  anonymousForges: true,
  upstreamStore: cacheApiStore(() => caches.open("upstream")),
})
