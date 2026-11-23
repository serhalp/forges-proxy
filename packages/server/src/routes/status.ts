import { encode } from "forges/wire"
import type { EventHandler } from "h3"
import type { Context } from "../context.ts"

/**
 * Returns the latest rate-limit budgets observed by each provider on the responding server instance.
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
