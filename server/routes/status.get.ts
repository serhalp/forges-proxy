import { defineHandler } from "nitro"
import { useForges } from "#server/utils/forges.ts"

/**
 * Each provider's request budgets, as the latest upstream responses reported them. They're per server instance, so on
 * serverless platforms a reading reflects whichever instance answered.
 */
export default defineHandler((event) => {
  event.res.headers.set("cache-control", "no-store")
  return {
    providers: useForges().providers.map((provider) => ({
      forge: provider.forge,
      instance: provider.instance,
      rateLimits: provider.rateLimits(),
    })),
  }
})
