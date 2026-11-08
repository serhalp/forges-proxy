import type { EventHandler } from "h3"
import { getRouterParams } from "h3"
import { accessMode } from "#src/access.ts"
import { readArgs } from "#src/args.ts"
import type { Context } from "#src/context.ts"
import { errorResponse, proxyError } from "#src/errors.ts"
import { resultResponse } from "#src/response.ts"
import { responseTags } from "#src/tags.ts"
import { callVerb, routedVerb, withSignal } from "#src/verbs.ts"

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
      return errorResponse(error)
    }
    const tags = responseTags(
      forge,
      instance,
      read.args,
      result instanceof ReadableStream ? undefined : result,
    )
    return resultResponse(event.req, result, {
      verb,
      mode,
      tags,
      cdnHeaders: context.cdnHeaders,
    })
  }
}
