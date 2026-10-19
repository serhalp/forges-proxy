import { defineHandler } from "nitro"
import { getQuery, readBody } from "nitro/h3"
import { accessMode } from "#server/utils/access.ts"
import { cacheHeaders } from "#server/utils/cache.ts"
import { errorResponse, proxyError } from "#server/utils/errors.ts"
import { useForges } from "#server/utils/forges.ts"
import { responseTags } from "#server/utils/tags.ts"
import { upstreamScope } from "#server/utils/upstream-cache.ts"
import { argsProblem } from "#server/utils/validate.ts"
import { callVerb, VERBS, withSignal } from "#server/utils/verbs.ts"
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
  const wire = verb.write
    ? ((await readBody<{ args?: unknown }>(event))?.args ?? [])
    : parseArgs(query.args)
  if (!Array.isArray(wire)) {
    return proxyError(400, "`args` must be a JSON array")
  }
  const problem = argsProblem(name, wire)
  if (problem) {
    return proxyError(400, problem)
  }
  // JSON has no `undefined`, so a skipped optional argument arrives as `null`.
  const args = reviveArgs(wire.map((arg) => arg ?? undefined)) as unknown[]
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

  const upstream = upstreamScope()
  let result: unknown
  try {
    result = await upstream.run(async () =>
      callVerb(provider, name, withSignal(name, args, event.req.signal)),
    )
  } catch (error) {
    return errorResponse(error)
  }
  const tags = responseTags(
    forge,
    instance,
    args,
    result instanceof ReadableStream ? undefined : result,
  )
  // Upstream entries carry the response's tags, so a webhook purge reaches them along with the CDN's copy.
  await upstream.commit(tags)
  const headers = {
    ...cacheHeaders(verb, mode, tags),
    ...(upstream.outcomes.length ? { "x-upstream-cache": upstream.outcomes.join(", ") } : {}),
  }
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
