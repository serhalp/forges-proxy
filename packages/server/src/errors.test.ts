import assert from "node:assert/strict"
import { describe, it, mock } from "node:test"
import {
  ForgeApiError,
  InsufficientScopeError,
  NotFoundError,
  RateLimitedError,
  UnknownForgeError,
  UnsupportedOperationError,
} from "forges"
import { errorResponse, proxyError } from "./errors.ts"
import * as v from "valibot"

const context = { forge: "github", instance: "github.com", url: "https://api.github.com/repos/a/b" }

const silent = { error: () => {} }

describe("errorResponse", () => {
  it("forwards upstream 4xx statuses while stripping url and raw upstream body", async () => {
    const response = errorResponse(
      new NotFoundError("Not found", 404, "secret body", context),
      silent,
    )
    assert.equal(response.status, 404)
    assert.equal(response.headers.get("cache-control"), "no-store")
    assert.deepEqual(await response.json(), {
      error: {
        name: "NotFoundError",
        message: "Not found",
        forge: "github",
        instance: "github.com",
        status: 404,
      },
    })
  })

  it("strips the operator token's grantedScopes from InsufficientScopeError", async () => {
    const response = errorResponse(
      new InsufficientScopeError("Forbidden", 403, "", {
        ...context,
        acceptedScopes: ["repo"],
        grantedScopes: ["read:org", "admin:repo_hook"],
      }),
      silent,
    )
    const { error } = v.parse(
      v.object({ error: v.record(v.string(), v.unknown()) }),
      await response.json(),
    )
    assert.deepEqual(error.acceptedScopes, ["repo"])
    assert.equal(error.grantedScopes, undefined)
  })

  it("maps RateLimitedError to 429 with a Retry-After header", async (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: 0 })
    const response = errorResponse(
      new RateLimitedError("Slow down", 403, "", {
        ...context,
        resetAt: new Date(30_500),
        secondary: true,
      }),
      silent,
    )
    assert.equal(response.status, 429)
    assert.equal(response.headers.get("retry-after"), "31")
    assert.equal(
      v.parse(v.object({ error: v.object({ secondary: v.boolean() }) }), await response.json())
        .error.secondary,
      true,
    )
  })

  it("maps UnsupportedOperationError to 501 and UnknownForgeError to 404", () => {
    assert.equal(errorResponse(new UnsupportedOperationError("No", context), silent).status, 501)
    assert.equal(errorResponse(new UnknownForgeError("No", context), silent).status, 404)
  })

  it("maps upstream 5xx errors to 502", () => {
    assert.equal(errorResponse(new ForgeApiError("Down", 503, "", context), silent).status, 502)
  })

  it("maps upstream 401 errors to 502 so they are not confused with proxy auth failures", () => {
    assert.equal(
      errorResponse(new ForgeApiError("Bad credentials", 401, "", context), silent).status,
      502,
    )
  })

  it("masks unexpected non-ForgeError exceptions as 500 InternalError", async () => {
    const consoleError = mock.method(console, "error", () => {})
    const response = errorResponse(new Error("database password is hunter2"), silent)
    consoleError.mock.restore()
    assert.equal(response.status, 500)
    assert.deepEqual(await response.json(), {
      error: { name: "InternalError", message: "Internal error" },
    })
  })
})

describe("proxyError", () => {
  it("formats errors using the same envelope as ForgeError responses", async () => {
    const response = proxyError(405, "Use POST", { allow: "POST" })
    assert.equal(response.status, 405)
    assert.equal(response.headers.get("allow"), "POST")
    assert.deepEqual(await response.json(), { error: { name: "ProxyError", message: "Use POST" } })
  })
})
