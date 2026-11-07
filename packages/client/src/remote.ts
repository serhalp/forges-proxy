import type {
  AuthKind,
  FetchLike,
  ForgeCapabilities,
  ForgeOptionsBase,
  ForgeListing,
  ForgeProvider,
  ForgeVerb,
  KnownForgeKind,
  Page,
} from "forges"
import * as forges from "forges"
import { CAPABILITY_TABLE, forgeIterable, iteratePages } from "forges/kit"
import * as v from "valibot"
import { compatible, FORGES_VERSION } from "#src/version.ts"
import { decodeBytes, encodeBytes } from "#src/wire.ts"

export interface RemoteOptions {
  /** Where the proxy answers, such as `https://forges.example.com` or `https://example.com/forges/`. */
  url: string
  /** `FORGES_PROXY_SECRET` of a private instance. */
  secret?: string
  fetch?: FetchLike
}

const isObject = (value: unknown): value is object => typeof value === "object" && value !== null

const RemoteIndex = v.object({
  /** Absent from proxies older than the check. */
  forges: v.optional(v.string()),
  providers: v.array(
    v.object({
      forge: v.string(),
      instance: v.string(),
      baseUrl: v.string(),
      // `forges` values the proxy passes through, trusted like verb results.
      authKind: v.custom<AuthKind>((value) => typeof value === "string"),
      capabilities: v.custom<ForgeCapabilities>(isObject),
    }),
  ),
  /** `options` is the position of the verb's options, or -1. A listing answers with one page. */
  verbs: v.array(
    v.object({ name: v.string(), write: v.boolean(), listing: v.boolean(), options: v.number() }),
  ),
})
type RemoteIndex = v.InferOutput<typeof RemoteIndex>

const ErrorBody = v.object({
  error: v.looseObject({ name: v.optional(v.string()), message: v.optional(v.string()) }),
})

type RemoteVerb = Omit<RemoteIndex["verbs"][number], "name">

type Factory = (options: ForgeOptionsBase) => ForgeProvider
// Credential-less providers answer the sync helpers (`urlFor`, `parseUrl`, ...) that need no request. Some factories'
// types require `auth`, which those helpers never use.
/* oxlint-disable typescript/no-unsafe-type-assertion */
const LOCAL: Record<string, Factory> = {
  "azure-devops": forges.azureDevOps as Factory,
  bitbucket: forges.bitbucket as Factory,
  "cloudflare-artifacts": forges.cloudflareArtifacts as Factory,
  "cursor-origin": forges.cursorOrigin as Factory,
  entire: forges.entire as Factory,
  forgejo: forges.forgejo as Factory,
  gitbucket: forges.gitbucket as Factory,
  gitea: forges.gitea as Factory,
  gitee: forges.gitee as Factory,
  github: forges.github as Factory,
  gitlab: forges.gitlab as Factory,
  pushin: forges.pushin as Factory,
  sourcehut: forges.sourcehut as Factory,
  tangled: forges.tangled as Factory,
} satisfies Record<KnownForgeKind, Factory>
/* oxlint-enable typescript/no-unsafe-type-assertion */

type ErrorClass = new (...args: never[]) => Error

const isErrorClass = (value: unknown): value is ErrorClass =>
  typeof value === "function" && value.prototype instanceof Error

const ERRORS = new Map<string, ErrorClass>()
for (const value of Object.values(forges)) {
  if (isErrorClass(value)) {
    ERRORS.set(value.name, value)
  }
}

/**
 * One `ForgeProvider` per forge the proxy at `url` serves, to pass to `createForges()`. Every verb is present: those
 * the proxy routes call it, listings read a page per request, and the rest reject with `UnsupportedOperationError`,
 * as `can()` reports.
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
  // Relative paths from here on, so a proxy mounted under a path prefix works too.
  const base = options.url.endsWith("/") ? options.url : `${options.url}/`
  const response = await fetch(base, { headers })
  if (!response.ok) {
    throw await toError(response, {})
  }
  const index = v.parse(RemoteIndex, await response.json())
  // A warning, not a rejection: most verbs survive a mismatch, and unrouted ones already reject.
  if (index.forges && !compatible(index.forges, FORGES_VERSION)) {
    console.warn(
      `forges-proxy: ${options.url} runs forges ${index.forges}, but this client was built against ${FORGES_VERSION}. Verbs whose arguments or results changed between them may fail.`,
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
  const local = localProvider(info)
  const origin = { forge, instance }
  const routed = (verb: string) => verbs.has(verb)
  const unsupported = (verb: string) =>
    new forges.UnsupportedOperationError(`The proxy does not route ${verb}`, origin)

  async function call(verb: string, args: unknown[]): Promise<unknown> {
    const { write, options: at } = verbs.get(verb)!
    // `AbortSignal`s can't travel as JSON; the request carries them instead.
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
      url.searchParams.set("args", JSON.stringify(sent, encodeBytes))
    }
    const response = await options.fetch(url.href, {
      method: write ? "POST" : "GET",
      headers: write ? { ...options.headers, "content-type": "application/json" } : options.headers,
      ...(write ? { body: JSON.stringify({ args: sent }, encodeBytes) } : {}),
      signal,
    })
    if (!response.ok) {
      throw await toError(response, origin)
    }
    if (response.status === 204) {
      return undefined
    }
    if (response.headers.get("content-type") === "application/octet-stream") {
      return response.body
    }
    // Bytes after dates, since `reviveDates` would take a `Uint8Array` apart.
    return decodeBytes(forges.reviveDates(await response.json()))
  }

  /** A listing: each page is a request, with the cursor in the options. */
  function listing(verb: string, at: number, args: unknown[]): ForgeListing<unknown> {
    const page = (pageOptions: object) =>
      // Trusted: the proxy answered with the `forges` listing's own page.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      call(verb, [
        ...Array.from({ length: at }, (_, index) => args[index]),
        pageOptions,
      ]) as Promise<Page<unknown>>
    const first = args[at] ?? {}
    return Object.assign(iteratePages(page, first), { page: () => page(first) })
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
    capabilities: info.capabilities,
    refreshCapabilities: async () => info.capabilities,
    rateLimits: () => [],
    request: () => Promise.reject(unsupported("request")),
    can: (verb: ForgeVerb, kind?: Parameters<ForgeProvider["can"]>[1]) =>
      routed(verb) && forges.can(info.capabilities, verb, kind),
    support: (verb: ForgeVerb, kind?: Parameters<ForgeProvider["support"]>[1]) =>
      routed(verb) ? forges.support(info.capabilities, verb, kind) : false,
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
  // Built from `CAPABILITY_TABLE` at runtime, so its verbs can't be typed one by one; tests cover the surface.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return provider as unknown as ForgeProvider
}

function localProvider(info: RemoteIndex["providers"][number]): ForgeProvider | undefined {
  try {
    return LOCAL[info.forge]?.({ baseUrl: info.baseUrl, instance: info.instance })
  } catch {
    // Some forges need options the proxy doesn't share, such as an organisation; their helpers go without.
    return undefined
  }
}

/** Rebuilds the error class the proxy reports, with its fields, without running its constructor. */
async function toError(response: Response, origin: object): Promise<Error> {
  const body = v.safeParse(ErrorBody, await response.json().catch(() => undefined))
  const {
    name = "ForgeApiError",
    message = response.statusText,
    ...fields
  } = body.success ? body.output.error : {}
  const Class = ERRORS.get(name)
  if (!Class) {
    return new forges.ForgeApiError(message, response.status, "", origin)
  }
  const error = Reflect.construct(Error, [message], Class)
  return Object.assign(error, forges.reviveDates(fields), { name })
}
