import assert from "node:assert/strict"
import { describe, it, mock } from "node:test"
import {
  ForgeApiError,
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
  it("passes upstream 4xx through without the url or upstream body", async () => {
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

  it("maps rate limits to 429 with retry-after", async (t) => {
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

  it("maps unsupported operations to 501 and unknown forges to 404", () => {
    assert.equal(errorResponse(new UnsupportedOperationError("No", context), silent).status, 501)
    assert.equal(errorResponse(new UnknownForgeError("No", context), silent).status, 404)
  })

  it("maps upstream 5xx to 502", () => {
    assert.equal(errorResponse(new ForgeApiError("Down", 503, "", context), silent).status, 502)
  })

  it("maps an upstream 401 to 502, so it doesn't read as a wrong proxy secret", () => {
    assert.equal(
      errorResponse(new ForgeApiError("Bad credentials", 401, "", context), silent).status,
      502,
    )
  })

  it("hides anything that is not a forge error", async () => {
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
  it("uses the same shape as forge errors", async () => {
    const response = proxyError(405, "Use POST", { allow: "POST" })
    assert.equal(response.status, 405)
    assert.equal(response.headers.get("allow"), "POST")
    assert.deepEqual(await response.json(), { error: { name: "ProxyError", message: "Use POST" } })
  })
})
