import { encode } from "forges/wire"
import type { EventHandler } from "h3"
import type { Context } from "../context.ts"

/**
 * Each provider's request budgets, as the latest upstream responses reported them. They're per server instance, so on
 * serverless platforms a reading reflects whichever instance answered.
 */
export function statusRoute(context: Context): EventHandler {
  return (event) => {
    event.res.headers.set("cache-control", "no-store")
    return encode({
      providers: context.forges().providers.map((provider) => ({
        forge: provider.forge,
        instance: provider.instance,
        rateLimits: provider.rateLimits(),
      })),
    })
  }
}
