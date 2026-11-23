import type { ForgeEvent } from "forges"
import type { EventHandler } from "h3"
import { getRouterParams } from "h3"
import type { Context } from "../context.ts"
import { errorResponse, proxyError } from "../errors.ts"
import { purgeTags } from "../tags.ts"

/**
 * Handles `POST /webhooks/:forge/:instance`: verifies the delivery signature using the provider's
 * configured webhook secret, purges CDN cache tags for all affected repositories, and invokes
 * `handleEvents`.
 */
export function webhookRoute(context: Context): EventHandler {
  return async (event) => {
    const { forge, instance } = getRouterParams(event, { decode: true })
    const provider = context.forges().for({ forge, instance })
    if (!provider) {
      return proxyError(404, `No provider is configured for ${forge} on ${instance}`)
    }
    let events: ForgeEvent[]
    try {
      events = await provider.webhooks.ingest({
        headers: event.req.headers,
        body: new Uint8Array(await event.req.arrayBuffer()),
      })
    } catch (error) {
      return errorResponse(error, context.logger)
    }
    const tags = purgeTags(events)
    if (context.purge && tags.length) {
      await context.purge(tags)
    }
    if (context.handleEvents && events.length) {
      try {
        await context.handleEvents(events, { forge, instance })
      } catch (error) {
        // Return 500 without leaking internal error details so the forge marks the delivery as failed.
        context.logger.error({ message: "handleEvents failed", error })
        return proxyError(500, "handleEvents failed")
      }
    }
    return { purged: context.purge ? tags : [] }
  }
}
