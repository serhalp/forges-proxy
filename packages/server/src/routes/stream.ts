import { UnsupportedOperationError } from "forges"
import type { EventHandler } from "h3"
import { EventStream, getRouterParams } from "h3"
import type { Context } from "../context.ts"
import { errorResponse, proxyError } from "../errors.ts"
import { serialize } from "../wire.ts"

// Proxies and CDNs drop connections that go quiet for long.
const HEARTBEAT_MS = 15_000

/**
 * Follows the provider's `sources.stream()` as server-sent events. Each event's `id` is its cursor, so a client resumes
 * with `Last-Event-ID` (as `EventSource` does) or `?cursor=`. A failure ends the stream with an `error` event carrying
 * the proxy's error body.
 */
export function streamRoute(context: Context): EventHandler {
  return (event) => {
    const { forge, instance } = getRouterParams(event, { decode: true })
    const provider = context.forges().for({ forge, instance })
    if (!provider) {
      return proxyError(404, `No provider is configured for ${forge} on ${instance}`)
    }
    if (!provider.can("sources.stream")) {
      const error = new UnsupportedOperationError(`${forge} on ${instance} has no event stream`, {
        forge,
        instance,
      })
      return errorResponse(error, context.logger)
    }
    const cursor =
      event.req.headers.get("last-event-id") ?? event.url.searchParams.get("cursor") ?? undefined
    const stream = new EventStream(event)
    const closed = new AbortController()
    stream.onClosed(() => closed.abort())
    const heartbeat = setInterval(() => void stream.pushComment("heartbeat"), HEARTBEAT_MS)
    void (async () => {
      try {
        for await (const item of provider.sources.stream({ cursor, signal: closed.signal })) {
          await stream.push({ id: item.cursor, data: serialize(item.event, { raw: false }) })
        }
      } catch (error) {
        await stream.push({
          event: "error",
          data: await errorResponse(error, context.logger).text(),
        })
      } finally {
        clearInterval(heartbeat)
        await stream.close()
      }
    })()
    return stream
  }
}
