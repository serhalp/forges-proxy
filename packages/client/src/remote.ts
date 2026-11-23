import type {
  AuthKind,
  FetchLike,
  ForgeCapabilities,
  ForgeListing,
  ForgeProvider,
  ForgeVerb,
  Page,
  RateLimit,
} from "forges"
import { can, ForgeApiError, StreamClosedError, support, UnsupportedOperationError } from "forges"
import { CAPABILITY_TABLE, forgeIterable, iteratePages } from "forges/kit"
import { decode, encode } from "forges/wire"
import { EventSourceParserStream } from "eventsource-parser/stream"
import * as v from "valibot"
import { compatible, FORGES_VERSION } from "./version.ts"
import { ERRORS } from "./errors.ts"

export interface RemoteOptions {
  /** Base URL of the `forges-proxy` deployment (e.g. `https://forges.example.com` or `https://example.com/forges/`). */
  url: string
  /** Bearer token matching `FORGES_PROXY_SECRET` on a private instance. */
  secret?: string
  fetch?: FetchLike
  /**
   * `forges` provider factories (e.g. `github` from `forges/github`) used to run synchronous
   * helper methods (`urlFor`, `parseUrl`, etc.) locally. Pass `allFactories` from
   * `@forges-proxy/client/all` to include all forges. @default []
   */
  factories?: readonly ProviderFactory[]
}

/** A `forges` provider factory function. */
export type ProviderFactory = (options: never) => ForgeProvider

const isObject = (value: unknown): value is object => typeof value === "object" && value !== null

const RemoteIndex = v.object({
  forges: v.optional(v.string()),
  providers: v.array(
    v.object({
      forge: v.string(),
      instance: v.string(),
      baseUrl: v.string(),
      authKind: v.custom<AuthKind>((value) => typeof value === "string"),
      capabilities: v.custom<ForgeCapabilities>(isObject),
    }),
  ),
  /** `options` is the parameter index of the verb's options argument, or -1 if none. */
  verbs: v.array(
    v.object({ name: v.string(), write: v.boolean(), listing: v.boolean(), options: v.number() }),
  ),
})
type RemoteIndex = v.InferOutput<typeof RemoteIndex>

const RATE_LIMITS_HEADER = "forges-rate-limits"
const RateLimits = v.array(v.custom<RateLimit>(isObject))

const ErrorBody = v.object({
  error: v.looseObject({ name: v.optional(v.string()), message: v.optional(v.string()) }),
})

type RemoteVerb = Omit<RemoteIndex["verbs"][number], "name">

/**
 * Connects to a `forges-proxy` instance at `options.url` and returns one `ForgeProvider` per
 * configured provider, ready to pass to `createForges()`. Routed verbs execute over HTTP, listings
 * fetch one page per request, and unrouted verbs reject with `UnsupportedOperationError`.
 * @example
 * ```ts
 * const forges = createForges(await connect({ url: 'https://forges.example.com', secret }))
 * ```
 */
export async function connect(options: RemoteOptions): Promise<ForgeProvider[]> {
  const fetch = options.fetch ?? globalThis.fetch
  const headers: Record<string, string> = options.secret
    ? { authorization: `Bearer ${options.secret}` }
    : {}
  // Ensure a trailing slash so relative URL resolution works when the proxy is mounted under a subpath.
  const base = options.url.endsWith("/") ? options.url : `${options.url}/`
  const response = await fetch(base, { headers })
  if (!response.ok) {
    throw await toError(response, {})
  }
  const index = v.parse(RemoteIndex, await response.json())
  if (index.forges && !compatible(index.forges, FORGES_VERSION)) {
    throw new Error(
      `forges-proxy: ${options.url} runs forges ${index.forges}, but this client was built against ${FORGES_VERSION}. Update both to the same wire format.`,
    )
  }
  const verbs = new Map(index.verbs.map(({ name, ...verb }) => [name, verb]))
  return index.providers.map((info) =>
    remoteProvider(info, verbs, { ...options, url: base, fetch, headers }),
  )
}

function remoteProvider(
  info: RemoteIndex["providers"][number],
  verbs: Map<string, RemoteVerb>,
  options: RemoteOptions & { fetch: FetchLike; headers: Record<string, string> },
): ForgeProvider {
  const { forge, instance } = info
  const local = localProvider(info, options.factories ?? [])
  const origin = { forge, instance }
  const routed = (verb: string) => verbs.has(verb)
  const unsupported = (verb: string) =>
    new UnsupportedOperationError(`The proxy does not route ${verb}`, origin)
  let capabilities = info.capabilities
  let budgets: RateLimit[] = []

  /** Updates cached rate-limit budgets from the `forges-rate-limits` response header. */
  function remember(response: Response): void {
    const header = response.headers.get(RATE_LIMITS_HEADER)
    if (!header) return
    try {
      budgets = v.parse(RateLimits, decode(JSON.parse(header)))
    } catch {
      // Ignore malformed headers and keep the previous budgets.
    }
  }

  /** Re-fetches `GET /` to update this provider's capabilities. */
  async function refreshCapabilities(): Promise<ForgeCapabilities> {
    const response = await options.fetch(options.url, { headers: options.headers })
    if (!response.ok) {
      throw await toError(response, origin)
    }
    const index = v.parse(RemoteIndex, await response.json())
    const own = index.providers.find(
      (entry) => entry.forge === forge && entry.instance === instance,
    )
    capabilities = own?.capabilities ?? capabilities
    return capabilities
  }

  async function call(verb: string, args: unknown[]): Promise<unknown> {
    const { write, options: at } = verbs.get(verb)!
    // Strip `AbortSignal` from the JSON arguments and pass it to `fetch()` instead.
    const own = args[at]
    let signal: AbortSignal | undefined
    let sent = args
    if (isObject(own) && "signal" in own) {
      const { signal: given, ...rest } = own
      signal = given instanceof AbortSignal ? given : undefined
      sent = args.with(at, rest)
    }
    const url = new URL(
      `${encodeURIComponent(forge)}/${encodeURIComponent(instance)}/${verb}`,
      options.url,
    )
    if (!write) {
      url.searchParams.set("args", JSON.stringify(encode(sent)))
    }
    const response = await options.fetch(url.href, {
      method: write ? "POST" : "GET",
      headers: write ? { ...options.headers, "content-type": "application/json" } : options.headers,
      ...(write ? { body: JSON.stringify({ args: encode(sent) }) } : {}),
      signal,
    })
    remember(response)
    if (!response.ok) {
      throw await toError(response, origin)
    }
    if (response.status === 204) {
      return undefined
    }
    if (response.headers.get("content-type") === "application/octet-stream") {
      return response.body
    }
    return decode(await response.json())
  }

  function listing(verb: string, at: number, args: unknown[]): ForgeListing<unknown> {
    const page = (pageOptions: object) =>
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      call(verb, [
        ...Array.from({ length: at }, (_, index) => args[index]),
        pageOptions,
      ]) as Promise<Page<unknown>>
    const first = args[at] ?? {}
    return Object.assign(iteratePages(page, first), { page: () => page(first) })
  }

  /** Streams `sources.stream` over SSE, throwing `StreamClosedError` when the connection ends without aborting. */
  async function* stream(streamOptions: { cursor?: string; signal?: AbortSignal } = {}) {
    const { signal } = streamOptions
    let cursor = streamOptions.cursor
    const url = new URL(
      `${encodeURIComponent(forge)}/${encodeURIComponent(instance)}/sources.stream`,
      options.url,
    )
    const response = await options.fetch(url.href, {
      headers: { ...options.headers, ...(cursor ? { "last-event-id": cursor } : {}) },
      signal,
    })
    if (!response.ok) {
      throw await toError(response, origin)
    }
    const messages = response
      .body!.pipeThrough(new TextDecoderStream())
      .pipeThrough(new EventSourceParserStream())
    try {
      for await (const message of messages) {
        if (message.event === "error") {
          throw errorFrom(JSON.parse(message.data), 502, origin)
        }
        cursor = message.id ?? cursor
        yield { event: decode(JSON.parse(message.data)), cursor }
      }
    } catch (error) {
      if (signal?.aborted) return
      throw error
    }
    if (signal?.aborted) return
    throw new StreamClosedError(`The stream from ${instance} closed`, cursor, origin)
  }

  const namespaces: Record<string, Record<string, unknown>> = {}
  for (const entry of CAPABILITY_TABLE) {
    for (const verb of entry.verbs ?? []) {
      const [namespace, name] = verb.split(".")
      namespaces[namespace] ??= {}
      namespaces[namespace][name] = method(verb, !!entry.listings?.includes(verb))
    }
  }
  namespaces.webhooks.events = local?.webhooks.events ?? []
  namespaces.installations.provider = () => {
    throw unsupported("installations.provider")
  }

  function method(verb: string, isListing: boolean): (...args: unknown[]) => unknown {
    const remote = verbs.get(verb)
    if (verb === "sources.stream") {
      return remote
        ? (streamOptions) => stream(isObject(streamOptions) ? streamOptions : {})
        : async function* () {
            yield* []
            throw unsupported(verb)
          }
    }
    if (remote?.listing) {
      return (...args) => listing(verb, remote.options, args)
    }
    if (remote) {
      return (...args) => call(verb, args)
    }
    if (isListing) {
      return () =>
        Object.assign(
          forgeIterable(async function* () {
            yield* []
            throw unsupported(verb)
          }),
          { page: () => Promise.reject(unsupported(verb)) },
        )
    }
    return () => Promise.reject(unsupported(verb))
  }

  const provider = {
    ...namespaces,
    forge,
    instance,
    baseUrl: info.baseUrl,
    authKind: info.authKind,
    get capabilities() {
      return capabilities
    },
    refreshCapabilities,
    rateLimits: () =>
      budgets.filter((budget) => !budget.resetAt || budget.resetAt.getTime() > Date.now()),
    request: () => Promise.reject(unsupported("request")),
    can: (verb: ForgeVerb, kind?: Parameters<ForgeProvider["can"]>[1]) =>
      routed(verb) && can(capabilities, verb, kind),
    support: (verb: ForgeVerb, kind?: Parameters<ForgeProvider["support"]>[1]) =>
      routed(verb) ? support(capabilities, verb, kind) : false,
    normaliseMarkdown: (body: string) => local?.normaliseMarkdown(body) ?? body,
    urlFor: (target: Parameters<ForgeProvider["urlFor"]>[0]) => local?.urlFor(target),
    webOrigin: local?.webOrigin,
    scopesFor: (verb: ForgeVerb) => local?.scopesFor(verb) ?? {},
    parseUrl: (url: string | URL) => local?.parseUrl(url),
    referenceFor: (...args: Parameters<ForgeProvider["referenceFor"]>) =>
      local?.referenceFor(...args),
    parseReferences: (...args: Parameters<ForgeProvider["parseReferences"]>) =>
      local?.parseReferences(...args) ?? [],
  }
  // Built dynamically from `CAPABILITY_TABLE` at runtime; test suites verify the full `ForgeProvider` surface.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return provider as unknown as ForgeProvider
}

/** Instantiates a local, unauthenticated provider from `factories` to run synchronous helper methods. */
function localProvider(
  info: RemoteIndex["providers"][number],
  factories: readonly ProviderFactory[],
): ForgeProvider | undefined {
  for (const factory of factories) {
    try {
      const provider: unknown = Reflect.apply(factory, undefined, [
        { baseUrl: info.baseUrl, instance: info.instance },
      ])
      if (isObject(provider) && "forge" in provider && provider.forge === info.forge) {
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion
        return provider as ForgeProvider
      }
    } catch {
      // Ignore factories that require options not exposed by `GET /` (such as an organization name).
    }
  }
  return undefined
}

/** Reconstructs a `ForgeError` subclass instance from an error response without invoking its subclass constructor. */
async function toError(response: Response, origin: object): Promise<Error> {
  return errorFrom(await response.json().catch(() => undefined), response.status, origin)
}

function errorFrom(json: unknown, status: number, origin: object): Error {
  const body = v.safeParse(ErrorBody, json)
  const {
    name = "ForgeApiError",
    message = `The proxy answered ${status}`,
    ...fields
  } = body.success ? body.output.error : {}
  const Class = ERRORS.get(name)
  if (!Class) {
    return new ForgeApiError(message, status, "", origin)
  }
  const error = Reflect.construct(Error, [message], Class)
  return Object.assign(error, decode(fields), { name })
}
