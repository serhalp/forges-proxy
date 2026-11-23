import {
  ForgeApiError,
  ForgeError,
  RateLimitedError,
  UnknownForgeError,
  UnsupportedOperationError,
  WebhookVerificationError,
} from "forges"
import { encode } from "forges/wire"
import type { Logger } from "./context.ts"

/** Maps an error thrown by a provider verb to an HTTP response, masking unexpected non-ForgeError exceptions. */
export function errorResponse(error: unknown, logger: Logger): Response {
  if (!(error instanceof ForgeError)) {
    logger.error({ message: "Unexpected error", error })
    return json(500, { name: "InternalError", message: "Internal error" })
  }
  // Preserve subclass fields for client reconstruction, but strip upstream `url`, raw `body`, and token `grantedScopes`.
  const {
    url: _url,
    body: _body,
    grantedScopes: _grantedScopes,
    ...fields
  } = error as ForgeError & { body?: string; grantedScopes?: string[] }
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
  // Map upstream 401s to 502 Bad Gateway so callers don't confuse an invalid forge token with an invalid proxy secret.
  if (error instanceof ForgeApiError && error.status === 401) {
    return json(502, body)
  }
  if (error instanceof UnsupportedOperationError) {
    return json(501, body)
  }
  if (error instanceof UnknownForgeError) {
    return json(404, body)
  }
  return json(
    error instanceof ForgeApiError && error.status >= 400 && error.status < 500
      ? error.status
      : 502,
    body,
  )
}

/** Formats a proxy-level error response using the same `{ error: { name, message } }` envelope as `ForgeError`. */
export function proxyError(
  status: number,
  message: string,
  headers: Record<string, string> = {},
): Response {
  return json(status, { name: "ProxyError", message }, headers)
}

function json(status: number, error: object, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(encode({ error })), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...headers },
  })
}
