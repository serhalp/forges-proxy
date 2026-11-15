import { sha256Hex } from "forges/kit"
import type { AccessMode } from "./access.ts"
import type { CdnHeaders } from "./context.ts"
import type { VerbSignature } from "./manifest.ts"
import { serialize } from "./wire.ts"

const CDN_CACHE_CONTROL = "public, max-age=60, stale-while-revalidate=600"

/**
 * Only public reads go to shared caches. Private instances send `no-store` until CDN caching can vary on the proxy
 * secret.
 */
function isCacheable(verb: VerbSignature, mode: AccessMode): boolean {
  return mode === "public" && !verb.write
}

/**
 * The response for a verb's result: a stream as `application/octet-stream`, `undefined` as 204, anything else as JSON.
 * Cacheable JSON carries a weak `ETag`, and a matching `If-None-Match` gets a 304.
 */
export async function resultResponse(
  request: Request,
  result: unknown,
  context: {
    verb: VerbSignature
    mode: AccessMode
    tags: string[]
    cdnHeaders: CdnHeaders
  },
): Promise<Response> {
  const cacheable = isCacheable(context.verb, context.mode)
  const headers = cacheable
    ? {
        // Browsers always revalidate; the CDN keeps a read briefly and is purged by tag.
        "cache-control": "public, max-age=0, must-revalidate",
        ...context.cdnHeaders({ cacheControl: CDN_CACHE_CONTROL, tags: context.tags }),
      }
    : { "cache-control": "private, no-store" }
  if (result instanceof ReadableStream) {
    return new Response(result, {
      headers: { "content-type": "application/octet-stream", ...headers },
    })
  }
  if (result === undefined) {
    return new Response(null, { status: 204, headers })
  }
  const body = serialize(result, { raw: new URL(request.url).searchParams.get("raw") === "1" })
  if (!cacheable) {
    return new Response(body, { headers: { "content-type": "application/json", ...headers } })
  }
  // Weak, since the CDN may compress the body.
  const etag = `W/"${(await sha256Hex(body)).slice(0, 32)}"`
  if (
    request.headers
      .get("if-none-match")
      ?.split(/\s*,\s*/)
      .includes(etag)
  ) {
    return new Response(null, { status: 304, headers: { etag, ...headers } })
  }
  return new Response(body, { headers: { "content-type": "application/json", etag, ...headers } })
}

/** The standard headers, which most CDNs read. */
export const standardCdnHeaders: CdnHeaders = ({ cacheControl, tags }) => ({
  "cdn-cache-control": cacheControl,
  "cache-tag": tags.join(","),
})
