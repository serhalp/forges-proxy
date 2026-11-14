import type { ForgeProvider } from "forges"
import type { EventHandler } from "h3"
import { getRouterParams } from "h3"
import { accessMode } from "../access.ts"
import { readArgs } from "../args.ts"
import type { Context } from "../context.ts"
import { errorResponse, proxyError } from "../errors.ts"
import { resultResponse } from "../response.ts"
import { responseTags } from "../tags.ts"
import { callVerb, routedVerb, withSignal } from "../verbs.ts"

const RATE_LIMITS_HEADER = "forges-rate-limits"

/**
 * Calls one provider verb. Reads are `GET ?args=<json array>`, writes are `POST { args }`, with the arguments
 * positional, as the verb takes them.
 */
export function verbRoute(context: Context): EventHandler {
  return async (event) => {
    const { forge, instance, verb: name } = getRouterParams(event, { decode: true })
    const mode = accessMode(context.env)
    const verb = routedVerb(name, mode)
    if (!verb) {
      return proxyError(404, `Unknown verb ${name}`)
    }
    const allowed = verb.write ? "POST" : "GET"
    if (event.req.method !== allowed) {
      return proxyError(405, `Use ${allowed} for ${name}`, { allow: allowed })
    }
    const provider = context.forges().for({ forge, instance })
    if (!provider) {
      return proxyError(404, `No provider is configured for ${forge} on ${instance}`)
    }
    const read = await readArgs(event, name, verb, { forge, instance })
    if ("problem" in read) {
      return proxyError(400, read.problem)
    }

    let result: unknown
    try {
      result = await callVerb(provider, name, verb, withSignal(verb, read.args, event.req.signal))
    } catch (error) {
      return withRateLimits(errorResponse(error, context.logger), provider)
    }
    const tags = responseTags(
      forge,
      instance,
      read.args,
      result instanceof ReadableStream ? undefined : result,
    )
    return withRateLimits(
      await resultResponse(event.req, result, { verb, mode, tags, cdnHeaders: context.cdnHeaders }),
      provider,
    )
  }
}

/**
 * The provider's budgets as its latest upstream responses reported them, for the client's `rateLimits()`. They're this
 * server instance's view, and a CDN copy of the response carries the budgets from when it was cached.
 */
function withRateLimits(response: Response, provider: ForgeProvider): Response {
  const budgets = provider.rateLimits()
  if (budgets.length) {
    response.headers.set(RATE_LIMITS_HEADER, JSON.stringify(budgets))
  }
  return response
}
