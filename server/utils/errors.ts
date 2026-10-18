import {
  ForgeApiError,
  ForgeError,
  RateLimitedError,
  UnknownForgeError,
  UnsupportedOperationError,
} from "forges"

/** The response for an error thrown by a verb, without leaking anything that is not a forge error. */
export function errorResponse(error: unknown): Response {
  if (!(error instanceof ForgeError)) {
    console.error(error)
    return json(500, { name: "InternalError", message: "Internal error" })
  }
  // `url` and the upstream `body` are left out: either can carry details of private data.
  const body = {
    name: error.name,
    message: error.message,
    forge: error.forge,
    instance: error.instance,
    ...(error instanceof ForgeApiError ? { status: error.status } : {}),
    ...(error instanceof RateLimitedError
      ? { resetAt: error.resetAt, secondary: error.secondary }
      : {}),
  }
  if (error instanceof RateLimitedError) {
    const retryAfter = error.resetAt
      ? Math.max(0, Math.ceil((error.resetAt.getTime() - Date.now()) / 1000))
      : undefined
    return json(429, body, retryAfter === undefined ? {} : { "retry-after": String(retryAfter) })
  }
  if (error instanceof UnsupportedOperationError) {
    return json(501, body)
  }
  if (error instanceof UnknownForgeError) {
    return json(404, body)
  }
  // Upstream 4xx are the caller's problem (not found, forbidden, invalid input); anything else is a bad gateway.
  return json(
    error instanceof ForgeApiError && error.status >= 400 && error.status < 500
      ? error.status
      : 502,
    body,
  )
}

/** An error of the proxy itself, in the same shape as forge errors. */
export function proxyError(
  status: number,
  message: string,
  headers: Record<string, string> = {},
): Response {
  return json(status, { name: "ProxyError", message }, headers)
}

function json(status: number, error: object, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...headers },
  })
}
