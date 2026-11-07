import type { EventHandler } from "h3"
import type { Context } from "#src/context.ts"
import { errorResponse, proxyError } from "#src/errors.ts"
import { purgeTags } from "#src/tags.ts"

/**
 * Receives a forge's webhook deliveries, verified with the provider's `WEBHOOK_SECRET`, and purges the cached responses
 * of every repository they concern. Point the forge's webhook at `/webhooks/:forge/:instance`.
 */
export function webhook(context: Context): EventHandler {
  return async (event) => {
    const { forge, instance } = event.context.params as { forge: string; instance: string }
    const provider = context.forges().for({ forge, instance })
    if (!provider) {
      return proxyError(404, `No provider is configured for ${forge} on ${instance}`)
    }
    let tags: string[]
    try {
      const events = await provider.webhooks.ingest({
        headers: event.req.headers,
        body: new Uint8Array(await event.req.arrayBuffer()),
      })
      tags = purgeTags(events)
    } catch (error) {
      return errorResponse(error)
    }
    // Otherwise a refill of the purged entries could come from upstream responses the proxy still holds as fresh.
    context.expireUpstream()
    if (context.purge && tags.length) {
      await context.purge(tags)
    }
    return { purged: context.purge ? tags : [] }
  }
}
