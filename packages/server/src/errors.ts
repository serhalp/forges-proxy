import {
  ForgeApiError,
  ForgeError,
  RateLimitedError,
  UnknownForgeError,
  UnsupportedOperationError,
  WebhookVerificationError,
} from "forges"
import type { Logger } from "./context.ts"

/** The response for an error thrown by a verb, without leaking anything that is not a forge error. */
export function errorResponse(error: unknown, logger: Logger): Response {
  if (!(error instanceof ForgeError)) {
    logger.error({ message: "Unexpected error", error })
    return json(500, { name: "InternalError", message: "Internal error" })
  }
  // Every field the error class sets, so clients can rebuild it, except `url` and the upstream `body`: either can
  // carry details of private data.
  const { url: _url, body: _body, ...fields } = error as ForgeError & { body?: string }
  const body = { ...fields, name: error.name, message: error.message }
  if (error instanceof RateLimitedError) {
    const retryAfter = error.resetAt
      ? Math.max(0, Math.ceil((error.resetAt.getTime() - Date.now()) / 1000))
      : undefined
    return json(429, body, retryAfter === undefined ? {} : { "retry-after": String(retryAfter) })
  }
  if (error instanceof WebhookVerificationError) {
    return json(401, body)
  }
  // The proxy's own forge credential failed; a 401 would read as a wrong proxy secret.
  if (error instanceof ForgeApiError && error.status === 401) {
    return json(502, body)
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
