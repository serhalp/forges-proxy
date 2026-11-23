import type { ForgeProvider } from "forges"
import { encode } from "forges/wire"
import type { EventHandler } from "h3"
import { getRouterParams } from "h3"
import { accessMode } from "../access.ts"
import { readArgs } from "../args.ts"
import type { Context } from "../context.ts"
import { signPage, signsCursors, unsignedCursor } from "../cursors.ts"
import { errorResponse, proxyError } from "../errors.ts"
import { isCacheable, resultResponse } from "../response.ts"
import { responseTags } from "../tags.ts"
import { callVerb, routedVerb, withSignal } from "../verbs.ts"

const RATE_LIMITS_HEADER = "forges-rate-limits"

/**
 * Dispatches a provider verb call: `GET ?args=<json array>` for reads and `POST { args }` for
 * writes, where `args` are positional method arguments.
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
    const scope = `${forge}:${instance}`
    const key = signsCursors(mode, provider) ? await context.cursorKey() : undefined
    const unsigned = key && (await unsignedCursor(verb, read.args, key, scope))
    if (unsigned) {
      return proxyError(400, unsigned)
    }

    let result: unknown
    try {
      result = await callVerb(provider, name, verb, withSignal(verb, read.args, event.req.signal))
      if (key && verb.listing) {
        result = await signPage(result, key, scope)
      }
    } catch (error) {
      return withRateLimits(errorResponse(error, context.logger), provider)
    }
    const tags = responseTags(
      forge,
      instance,
      read.args,
      result instanceof ReadableStream ? undefined : result,
    )
    const response = await resultResponse(event.req, result, {
      verb,
      mode,
      tags,
      cdnHeaders: context.cdnHeaders,
    })
    // Omit `forges-rate-limits` on cacheable public reads so CDN cache hits do not replay stale budgets.
    return isCacheable(verb, mode) ? response : withRateLimits(response, provider)
  }
}

/**
 * Attaches the provider's latest observed rate-limit budgets in `forges-rate-limits` so the client
 * can update `provider.rateLimits()`.
 */
function withRateLimits(response: Response, provider: ForgeProvider): Response {
  const budgets = provider.rateLimits()
  if (budgets.length) {
    response.headers.set(RATE_LIMITS_HEADER, JSON.stringify(encode(budgets)))
  }
  return response
}
