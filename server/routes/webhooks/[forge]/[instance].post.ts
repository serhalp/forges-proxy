import { defineHandler } from "nitro"
import { errorResponse, proxyError } from "#server/utils/errors.ts"
import { expireUpstream, useForges } from "#server/utils/forges.ts"
import { usePurge } from "#server/utils/purge.ts"
import { purgeTags } from "#server/utils/tags.ts"

/**
 * Receives a forge's webhook deliveries, verified with the provider's `WEBHOOK_SECRET`, and purges the cached responses
 * of every repository they concern. Point the forge's webhook at `/webhooks/:forge/:instance`.
 */
export default defineHandler(async (event) => {
  const { forge, instance } = event.context.params as { forge: string; instance: string }
  const provider = useForges().for({ forge, instance })
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
  expireUpstream()
  const purge = usePurge()
  if (purge && tags.length) {
    await purge(tags)
  }
  return { purged: purge ? tags : [] }
})
