import { createServer } from "@forges-proxy/server"
import type { Config } from "@netlify/edge-functions"

// Upstream responses stay in memory per isolate, and webhooks expire them there; CDN entries expire by age.
// TODO: export the server itself once Edge Functions take a Fetchable.
export default createServer({
  env: Netlify.env.toObject(),
  anonymousForges: true,
  cdnHeaders: ({ cacheControl, tags }) => ({
    "netlify-cdn-cache-control": `${cacheControl}, durable`,
    "netlify-cache-tag": tags.join(","),
  }),
}).fetch

// Edge function responses are only cached when they opt in.
export const config: Config = { path: "/*", cache: "manual" }
