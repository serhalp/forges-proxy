import { sha256Hex } from "forges/kit"
import type { AccessMode } from "./access.ts"
import type { CdnHeaders } from "./context.ts"
import type { VerbSignature } from "./manifest.ts"
import { serialize } from "./wire.ts"

const CDN_CACHE_CONTROL = "public, max-age=60, stale-while-revalidate=600"

/**
 * Only public read responses are stored in shared CDN caches. Private instances always send
 * `private, no-store` because CDNs serve cached responses before auth middleware runs.
 */
function isCacheable(verb: VerbSignature, mode: AccessMode): boolean {
  return mode === "public" && !verb.write
}

/**
 * Serializes a verb's return value into an HTTP `Response`: `ReadableStream` as
 * `application/octet-stream`, `undefined` as `204 No Content`, and all other values as JSON with
 * weak `ETag` revalidation on cacheable public reads.
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
        // Force browsers to revalidate while allowing the CDN to cache and purge by tag.
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
  // Use a weak ETag so CDN content encoding (gzip/brotli) does not break `If-None-Match`.
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

export const standardCdnHeaders: CdnHeaders = ({ cacheControl, tags }) => ({
  "cdn-cache-control": cacheControl,
  "cache-tag": tags.join(","),
})
