import { createServer } from "@forges-proxy/server"
import type { Config } from "@netlify/edge-functions"

// Upstream responses stay in memory per isolate, and webhooks expire them there; CDN entries expire by age.
export default createServer({
  env: Netlify.env.toObject(),
  anonymousForges: true,
  cdnHeaders: ({ cacheControl, tags }) => ({
    "netlify-cdn-cache-control": `${cacheControl}, durable`,
    "netlify-cache-tag": tags.join(","),
  }),
})

// Edge function responses are only cached when they opt in.
export const config: Config = { path: "/*", cache: "manual" }
