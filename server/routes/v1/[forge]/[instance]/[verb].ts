import { defineHandler } from "nitro"
import { getQuery, readBody } from "nitro/h3"
import { accessMode } from "#server/utils/access.ts"
import { cacheHeaders } from "#server/utils/cache.ts"
import { errorResponse, proxyError } from "#server/utils/errors.ts"
import { useForges } from "#server/utils/forges.ts"
import { responseTags } from "#server/utils/tags.ts"
import { callVerb, VERBS } from "#server/utils/verbs.ts"
import { reviveArgs, serialise } from "#server/utils/wire.ts"

/**
 * Calls one provider verb. Reads are `GET ?args=<json array>`, writes are `POST { args }`. Arguments are positional,
 * as the verb's signature takes them, until an operations manifest gives them names.
 */
export default defineHandler(async (event) => {
  const {
    forge,
    instance,
    verb: name,
  } = event.context.params as { forge: string; instance: string; verb: string }
  const mode = accessMode()
  const verb = VERBS.get(name)
  if (!verb || (mode === "public" && (verb.write || verb.account))) {
    return proxyError(404, `Unknown verb ${name}`)
  }
  const allowed = verb.write ? "POST" : "GET"
  if (event.req.method !== allowed) {
    return proxyError(405, `Use ${allowed} for ${name}`, { allow: allowed })
  }
  const provider = useForges().for({ forge, instance })
  if (!provider) {
    return proxyError(404, `No provider is configured for ${forge} on ${instance}`)
  }

  const query = getQuery(event)
  const args = reviveArgs(
    verb.write ? ((await readBody<{ args?: unknown }>(event))?.args ?? []) : parseArgs(query.args),
  )
  if (!Array.isArray(args)) {
    return proxyError(400, "`args` must be a JSON array")
  }
  // A ref for another forge would be sent to this provider's host anyway; reject it rather than guess.
  for (const arg of args) {
    if (
      arg &&
      typeof arg === "object" &&
      "forge" in arg &&
      (arg.forge !== forge || ("instance" in arg && arg.instance !== instance))
    ) {
      return proxyError(
        400,
        `Argument names ${String(arg.forge)} on ${String((arg as { instance?: unknown }).instance)}, not ${forge} on ${instance}`,
      )
    }
  }

  let result: unknown
  try {
    result = await callVerb(provider, name, args)
  } catch (error) {
    return errorResponse(error)
  }
  const tags = responseTags(
    forge,
    instance,
    args,
    result instanceof ReadableStream ? undefined : result,
  )
  const headers = cacheHeaders(verb, mode, tags)
  if (result instanceof ReadableStream) {
    return new Response(result, {
      headers: { "content-type": "application/octet-stream", ...headers },
    })
  }
  if (result === undefined) {
    return new Response(null, { status: 204, headers })
  }
  return new Response(serialise(result, { raw: query.raw === "1" }), {
    headers: { "content-type": "application/json", ...headers },
  })
})

function parseArgs(value: unknown): unknown {
  if (value === undefined) {
    return []
  }
  try {
    return JSON.parse(String(value))
  } catch {
    return undefined
  }
}
