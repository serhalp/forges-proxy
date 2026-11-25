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
import {
  can,
  ForgeApiError,
  StreamClosedError,
  support,
  UnknownForgeError,
  UnsupportedOperationError,
} from "forges"
import { CAPABILITY_TABLE, forgeIterable, iteratePages } from "forges/kit"
import * as web from "forges/web"
import type { ForgeWeb } from "forges/web"
import { decode, encode } from "forges/wire"
import * as v from "valibot"
import { compatible, FORGES_VERSION } from "./version.ts"
import { ERRORS } from "./errors.ts"
import { OPTIONS_AT } from "./options.ts"

/** Connection options for a `forges-proxy` deployment. */
export interface ProxyOptions {
  /** Base URL of the `forges-proxy` deployment (e.g. `https://forges.example.com` or `https://example.com/forges/`). */
  url: string
  /** Bearer token matching `FORGES_PROXY_SECRET` on a private instance. */
  secret?: string
  fetch?: FetchLike
  /** Request timeout in milliseconds (SSE streams are exempt). @default 30000 */
  timeout?: number
  /**
   * What to do when the proxy runs a `forges` with another wire format: warn once, or throw.
   * Warning keeps browsers on an old bundle working while the proxy upgrades. @default "warn"
   */
  versionMismatch?: "warn" | "throw"
}

export interface DiscoverOptions extends ProxyOptions {
  /**
   * The proxy's metadata from {@link fetchProxyMeta}, allowing providers to be constructed
   * without fetching `GET /_meta` again (e.g. cached per process or passed from SSR to the browser).
   */
  meta?: ProxyMeta
  /**
   * `forges` provider factories (e.g. `github` from `forges/github`) used to run synchronous
   * helpers (`normaliseMarkdown`, `scopesFor`, `webhooks.events`, etc.) locally. Pass `allFactories`
   * from `@forges-proxy/client/all` to include all forges. @default []
   */
  factories?: readonly ProviderFactory[]
}

/** A `forges` provider factory function. */
export type ProviderFactory = (options: never) => ForgeProvider

const isObject = (value: unknown): value is object => typeof value === "object" && value !== null

const Meta: v.GenericSchema<unknown, ProxyMeta> = v.object({
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
  verbs: v.array(
    v.object({ name: v.string(), write: v.boolean(), listing: v.boolean(), options: v.number() }),
  ),
})
/**
 * What a proxy serves: its `forges` version, providers and their capabilities, and routed verbs.
 * Serializable.
 */
export interface ProxyMeta {
  forges?: string
  providers: Array<{
    forge: string
    instance: string
    baseUrl: string
    authKind: AuthKind
    capabilities: ForgeCapabilities
  }>
  /** `options` is the parameter index of the verb's options argument, or -1 if none. */
  verbs: Array<{ name: string; write: boolean; listing: boolean; options: number }>
}

const RATE_LIMITS_HEADER = "forges-rate-limits"
const VERSION_HEADER = "forges-version"
const RateLimits = v.array(v.custom<RateLimit>(isObject))

const ErrorBody = v.object({
  error: v.looseObject({ name: v.optional(v.string()), message: v.optional(v.string()) }),
})

type RemoteVerb = Omit<ProxyMeta["verbs"][number], "name">

/** Fetches the proxy's metadata (`GET /_meta`), for reuse with {@link discoverProviders}. */
export async function fetchProxyMeta(options: ProxyOptions): Promise<ProxyMeta> {
  const transport = transportFor(options)
  const response = await transport.fetch(new URL("_meta", transport.url).href, {
    headers: transport.headers,
  })
  if (!response.ok) {
    throw await toError(response, {})
  }
  return v.parse(Meta, await response.json())
}

/**
 * Returns one `ForgeProvider` per provider configured on the proxy at `options.url`, ready to pass
 * to `createForges()`. Routed verbs execute over HTTP, listings fetch one page per request, and
 * unrouted verbs reject with `UnsupportedOperationError`.
 * @example
 * ```ts
 * const forges = createForges(await discoverProviders({ url: 'https://forges.example.com', secret }))
 * ```
 */
export async function discoverProviders(options: DiscoverOptions): Promise<ForgeProvider[]> {
  const meta = options.meta ?? (await fetchProxyMeta(options))
  checkVersion(meta.forges, options)
  const verbs = new Map(meta.verbs.map(({ name, ...verb }) => [name, verb]))
  const transport = transportFor(options)
  return meta.providers.map((info) =>
    remoteProvider(info, verbs, transport, options.factories ?? []),
  )
}

export interface ProxyProviderOptions extends ProxyOptions {
  /** Forge kind identifier, e.g. `github`. */
  forge: string
  /** Upstream forge API base URL for self-hosted instances. */
  baseUrl?: string
  /** Forge instance hostname. @default hostname of `baseUrl`, or the forge's default public host */
  instance?: string
}

/**
 * Constructs a `ForgeProvider` for a single forge synchronously without fetching `GET /_meta`. Until
 * `refreshCapabilities()` is called, `can()` optimistically reports all verbs as supported,
 * `baseUrl` defaults to `options.baseUrl ?? ""`, and `authKind` defaults to `"anonymous"`. Calling
 * a verb not routed by the proxy rejects with `UnsupportedOperationError`.
 * @example
 * ```ts
 * const github = proxyProvider({ url: 'https://forges.example.com', forge: 'github' })
 * ```
 */
export function proxyProvider(options: ProxyProviderOptions): ForgeProvider {
  const instance = options.instance ?? webFor(options)?.instance
  if (!instance) {
    throw new TypeError(`proxyProvider: pass the instance of ${options.forge}`)
  }
  const verbs = new Map<string, RemoteVerb>()
  for (const entry of CAPABILITY_TABLE) {
    for (const verb of entry.verbs ?? []) {
      const listing = !!entry.listings?.includes(verb)
      verbs.set(verb, { write: !!entry.write, listing, options: OPTIONS_AT[verb] ?? -1 })
    }
  }
  const info = {
    forge: options.forge,
    instance,
    baseUrl: options.baseUrl ?? "",
    authKind: "anonymous" as const,
    capabilities: OPTIMISTIC,
  }
  return remoteProvider(info, verbs, transportFor(options), [])
}

/** Capability map with all verbs enabled, used by `proxyProvider()` prior to `refreshCapabilities()`. */
// oxlint-disable-next-line typescript/no-unsafe-type-assertion
const OPTIMISTIC = Object.fromEntries(
  Object.entries(
    Object.groupBy(
      CAPABILITY_TABLE.flatMap((entry) => entry.verbs ?? []),
      (verb) => verb.split(".")[0],
    ),
  ).map(([namespace, names = []]) => [
    namespace,
    Object.fromEntries(names.map((name) => [name.split(".")[1], true])),
  ]),
) as unknown as ForgeCapabilities

const WEB: Record<
  string,
  (options: { baseUrl?: string; instance?: string }) => ForgeWeb | undefined
> = {
  "azure-devops": web.azureDevOps,
  bitbucket: web.bitbucket,
  entire: web.entire,
  forgejo: web.forgejo,
  // GitBucket has no default public instance, so it requires `baseUrl`.
  gitbucket: ({ baseUrl, ...rest }) => (baseUrl ? web.gitbucket({ ...rest, baseUrl }) : undefined),
  gitcafe: web.gitcafe,
  gitea: web.gitea,
  gitee: web.gitee,
  github: web.github,
  gitlab: web.gitlab,
  pushin: web.pushin,
  sourcehut: web.sourcehut,
  tangled: web.tangled,
  upstream: web.upstream,
}

/** Builds `forges/web` link helpers for `info.forge`, or returns `undefined` if unsupported. */
function webFor(info: {
  forge: string
  baseUrl?: string
  instance?: string
}): ForgeWeb | undefined {
  try {
    return WEB[info.forge]?.({ baseUrl: info.baseUrl || undefined, instance: info.instance })
  } catch {
    return undefined
  }
}

const warned = new Set<string>()

/** Warns once per proxy and version, or throws, when the proxy's `forges` has another wire format. */
function checkVersion(version: string | null | undefined, options: ProxyOptions): void {
  if (!version || compatible(version, FORGES_VERSION)) {
    return
  }
  const message = `forges-proxy: ${options.url} runs forges ${version}, but this client was built against ${FORGES_VERSION}. Update both to the same wire format.`
  if (options.versionMismatch === "throw") {
    throw new Error(message)
  }
  const key = `${options.url} ${version}`
  if (!warned.has(key)) {
    warned.add(key)
    console.warn(message)
  }
}

interface Transport {
  proxy: ProxyOptions
  url: string
  headers: Record<string, string>
  /** `fetch` wrapper that applies the request timeout. */
  fetch: FetchLike
  /** Unwrapped `fetch` without a timeout, used for long-lived SSE streams. */
  stream: FetchLike
}

function transportFor(options: ProxyOptions): Transport {
  const stream = options.fetch ?? ((input, init) => globalThis.fetch(input, init))
  const timeout = options.timeout ?? 30_000
  return {
    proxy: options,
    // Ensure a trailing slash so relative URL resolution works when the proxy is mounted under a subpath.
    url: options.url.endsWith("/") ? options.url : `${options.url}/`,
    headers: options.secret ? { authorization: `Bearer ${options.secret}` } : {},
    fetch: (input, init = {}) =>
      stream(input, {
        ...init,
        signal: init.signal
          ? AbortSignal.any([init.signal, AbortSignal.timeout(timeout)])
          : AbortSignal.timeout(timeout),
      }),
    stream,
  }
}

function remoteProvider(
  info: ProxyMeta["providers"][number],
  verbs: Map<string, RemoteVerb>,
  options: Transport,
  factories: readonly ProviderFactory[],
): ForgeProvider {
  const { forge, instance } = info
  const local = localProvider(info, factories)
  const links = local ?? webFor(info)
  const origin = { forge, instance }
  let routedVerbs = new Set(verbs.keys())
  let { baseUrl, authKind } = info
  let versionChecked = false
  const routed = (verb: string) => routedVerbs.has(verb)
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

  /** Re-fetches `GET /_meta` to update this provider's capabilities. */
  async function refreshCapabilities(): Promise<ForgeCapabilities> {
    const response = await options.fetch(new URL("_meta", options.url).href, {
      headers: options.headers,
    })
    if (!response.ok) {
      throw await toError(response, origin)
    }
    const meta = v.parse(Meta, await response.json())
    checkVersion(meta.forges, options.proxy)
    const own = meta.providers.find((entry) => entry.forge === forge && entry.instance === instance)
    if (!own) {
      throw new UnknownForgeError(
        `The proxy serves no provider for ${forge} on ${instance}`,
        origin,
      )
    }
    ;({ capabilities, baseUrl, authKind } = own)
    routedVerbs = new Set(meta.verbs.map((verb) => verb.name))
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
    sent = canonical(sent, at)
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
    if (!versionChecked) {
      versionChecked = true
      checkVersion(response.headers.get(VERSION_HEADER), options.proxy)
    }
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
    const response = await options.stream(url.href, {
      headers: { ...options.headers, ...(cursor ? { "last-event-id": cursor } : {}) },
      signal,
    })
    if (!response.ok) {
      throw await toError(response, origin)
    }
    // Loaded here so bundles that never stream leave the parser out.
    const { EventSourceParserStream } = await import("eventsource-parser/stream")
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
    get baseUrl() {
      return baseUrl
    },
    get authKind() {
      return authKind
    },
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
    urlFor: (target: Parameters<ForgeProvider["urlFor"]>[0]) => links?.urlFor(target),
    webOrigin: links?.webOrigin,
    scopesFor: (verb: ForgeVerb) => local?.scopesFor(verb) ?? {},
    parseUrl: (url: string | URL) => links?.parseUrl(url),
    referenceFor: (...args: Parameters<ForgeProvider["referenceFor"]>) =>
      links?.referenceFor(...args),
    parseReferences: (...args: Parameters<ForgeProvider["parseReferences"]>) =>
      links?.parseReferences(...args) ?? [],
  }
  // Built dynamically from `CAPABILITY_TABLE` at runtime; test suites verify the full `ForgeProvider` surface.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return provider as unknown as ForgeProvider
}

/** Instantiates a local, unauthenticated provider from `factories` to run synchronous helper methods. */
function localProvider(
  info: ProxyMeta["providers"][number],
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
      // Ignore factories that require options not exposed by `GET /_meta` (such as an organization name).
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

/**
 * Equivalent calls as one URL, so they share a cache entry: `[repo, {}]` and `[repo, null]` are sent
 * as `[repo]`.
 */
function canonical(args: unknown[], at: number): unknown[] {
  const sent = at >= 0 && isEmpty(args[at]) ? args.with(at, undefined) : [...args]
  while (sent.length > 0 && sent.at(-1) == null) {
    sent.pop()
  }
  return sent
}

function isEmpty(value: unknown): boolean {
  return isObject(value) && Object.values(value).every((field) => field === undefined)
}
