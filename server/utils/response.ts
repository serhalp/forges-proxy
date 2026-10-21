import { sha256Hex } from "forges/kit"
import type { AccessMode } from "#server/utils/access.ts"
import type { ManifestVerb } from "#server/utils/manifest.ts"
import { serialise } from "#server/utils/wire.ts"

const READ_MAX_AGE = 60
const READ_STALE = 600

/**
 * Only public reads go to shared caches. Private instances send `no-store` until CDN caching can be keyed on the proxy
 * secret (see PLAN.md).
 */
export function isCacheable(verb: ManifestVerb, mode: AccessMode): boolean {
  return mode === "public" && !verb.write
}

/**
 * The response for a verb's result: a stream as `application/octet-stream`, `undefined` as 204, anything else as JSON.
 * Cacheable JSON carries a weak `ETag`, and a matching `If-None-Match` gets a 304.
 */
export async function resultResponse(
  request: Request,
  result: unknown,
  context: { verb: ManifestVerb; mode: AccessMode; tags: string[]; outcomes: string[] },
): Promise<Response> {
  const cacheable = isCacheable(context.verb, context.mode)
  const headers = {
    ...(cacheable ? cacheHeaders(context.tags) : { "cache-control": "private, no-store" }),
    ...(context.outcomes.length ? { "x-upstream-cache": context.outcomes.join(", ") } : {}),
  }
  if (result instanceof ReadableStream) {
    return new Response(result, {
      headers: { "content-type": "application/octet-stream", ...headers },
    })
  }
  if (result === undefined) {
    return new Response(null, { status: 204, headers })
  }
  const body = serialise(result, { raw: new URL(request.url).searchParams.get("raw") === "1" })
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

/** Browsers always revalidate; the CDN keeps a read briefly and is purged by tag. */
function cacheHeaders(tags: string[]): Record<string, string> {
  const cdn = `public, max-age=${READ_MAX_AGE}, stale-while-revalidate=${READ_STALE}`
  return {
    "cache-control": "public, max-age=0, must-revalidate",
    "cdn-cache-control": cdn,
    "netlify-cdn-cache-control": `${cdn}, durable`,
    "netlify-cache-tag": tags.join(","),
  }
}
