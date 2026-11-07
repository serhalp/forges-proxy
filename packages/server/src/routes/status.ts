import type { EventHandler } from "h3"
import type { Context } from "#src/context.ts"

/**
 * Each provider's request budgets, as the latest upstream responses reported them. They're per server instance, so on
 * serverless platforms a reading reflects whichever instance answered.
 */
export function status(context: Context): EventHandler {
  return (event) => {
    event.res.headers.set("cache-control", "no-store")
    return {
      providers: context.forges().providers.map((provider) => ({
        forge: provider.forge,
        instance: provider.instance,
        rateLimits: provider.rateLimits(),
      })),
    }
  }
}
