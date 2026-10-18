import type {
  AuthKind,
  FetchLike,
  ForgeCapabilities,
  ForgeOptionsBase,
  ForgeProvider,
  ForgeProviderFactory,
  ForgeVerb,
  Page,
} from "forges"
import * as forges from "forges"
import { CAPABILITY_TABLE, forgeIterable, fromBase64, iteratePages } from "forges/kit"

export interface RemoteOptions {
  /** The proxy's origin, such as `https://forges.example.com`. */
  url: string
  /** `FORGES_PROXY_SECRET` of a private instance. */
  secret?: string
  fetch?: FetchLike
}

interface RemoteIndex {
  providers: Array<{
    forge: string
    instance: string
    baseUrl: string
    authKind: AuthKind
    capabilities: ForgeCapabilities
  }>
  verbs: Array<{ name: string; write: boolean }>
}

type Factory = (options: ForgeOptionsBase) => ForgeProviderFactory
// Credential-less providers answer the sync helpers (`urlFor`, `parseUrl`, ...) that need no request.
const LOCAL: Record<string, Factory> = {
  "azure-devops": forges.azureDevOps as Factory,
  bitbucket: forges.bitbucket as Factory,
  "cloudflare-artifacts": forges.cloudflareArtifacts as Factory,
  "cursor-origin": forges.cursorOrigin as Factory,
  forgejo: forges.forgejo as Factory,
  gitea: forges.gitea as Factory,
  gitee: forges.gitee as Factory,
  github: forges.github as Factory,
  gitlab: forges.gitlab as Factory,
  pushin: forges.pushin as Factory,
  tangled: forges.tangled as Factory,
}

const ERRORS = new Map<string, new (...args: never[]) => Error>(
  Object.values(forges).flatMap((value) =>
    typeof value === "function" && value.prototype instanceof Error
      ? [[value.name, value as new (...args: never[]) => Error]]
      : [],
  ),
)

/**
 * One `ForgeProvider` per forge the proxy at `url` serves, to pass to `createForges()`. Every verb is present: those
 * the proxy routes call it, listings page through their `*Page` verb, and the rest reject with
 * `UnsupportedOperationError`, as `can()` reports.
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
  const response = await fetch(new URL("/v1", options.url).href, { headers })
  if (!response.ok) {
    throw await toError(response, {})
  }
  const index = (await response.json()) as RemoteIndex
  const writes = new Map(index.verbs.map((verb) => [verb.name, verb.write]))
  return index.providers.map((info) => remoteProvider(info, writes, { ...options, fetch, headers }))
}

function remoteProvider(
  info: RemoteIndex["providers"][number],
  writes: Map<string, boolean>,
  options: RemoteOptions & { fetch: FetchLike; headers: Record<string, string> },
): ForgeProvider {
  const { forge, instance } = info
  const local = localProvider(info)
  const origin = { forge, instance }
  const routed = (verb: string) => writes.has(verb) || writes.has(`${verb}Page`)
  const unsupported = (verb: string) =>
    new forges.UnsupportedOperationError(`The proxy does not route ${verb}`, origin)

  async function call(verb: string, args: unknown[]): Promise<unknown> {
    // `AbortSignal`s can't travel as JSON; the request carries them instead.
    let signal: AbortSignal | undefined
    const sent = args.map((arg) => {
      if (isOptions(arg) && arg.signal instanceof AbortSignal) {
        const { signal: own, ...rest } = arg
        signal = own as AbortSignal
        return rest
      }
      return arg
    })
    const url = new URL(
      `/v1/${encodeURIComponent(forge)}/${encodeURIComponent(instance)}/${verb}`,
      options.url,
    )
    const write = writes.get(verb)
    if (!write) {
      url.searchParams.set("args", JSON.stringify(sent))
    }
    const response = await options.fetch(url.href, {
      method: write ? "POST" : "GET",
      headers: write ? { ...options.headers, "content-type": "application/json" } : options.headers,
      ...(write ? { body: JSON.stringify({ args: sent }) } : {}),
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
    return decodeBytes(verb, sent, forges.reviveDates(await response.json()))
  }

  const namespaces: Record<string, Record<string, unknown>> = {}
  for (const verb of CAPABILITY_TABLE.flatMap((entry) => entry.verbs ?? [])) {
    const [namespace, name] = verb.split(".") as [string, string]
    namespaces[namespace] ??= {}
    if (writes.has(verb)) {
      namespaces[namespace][name] = (...args: unknown[]) => call(verb, args)
    } else if (writes.has(`${verb}Page`)) {
      namespaces[namespace][name] = (...args: unknown[]) => {
        // Refs always name their forge, so a trailing object without one is the listing's options.
        const last = args.at(-1)
        const [positional, listOptions] = isOptions(last) ? [args.slice(0, -1), last] : [args, {}]
        return iteratePages(
          (page) => call(`${verb}Page`, [...positional, page]) as Promise<Page<unknown>>,
          listOptions,
        )
      }
    } else if (CAPABILITY_TABLE.some((entry) => entry.verbs?.includes(`${verb}Page`))) {
      namespaces[namespace][name] = () =>
        forgeIterable(async function* () {
          yield* []
          throw unsupported(verb)
        })
    } else {
      namespaces[namespace][name] = () => Promise.reject(unsupported(verb))
    }
  }
  namespaces.webhooks!.events = local?.webhooks.events ?? []
  namespaces.installations!.provider = () => {
    throw unsupported("installations.provider")
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
      routed(verb) && forges.supports(info.capabilities, verb, kind),
    support: (verb: ForgeVerb, kind?: Parameters<ForgeProvider["support"]>[1]) =>
      routed(verb) ? forges.supportOf(info.capabilities, verb, kind) : false,
    normaliseMarkdown: (body: string) => local?.normaliseMarkdown(body) ?? body,
    urlFor: (target: Parameters<ForgeProvider["urlFor"]>[0]) => local?.urlFor(target),
    webOrigin: local?.webOrigin,
    scopesFor: (verb: ForgeVerb) => local?.scopesFor(verb) ?? {},
    parseUrl: (url: string | URL) => local?.parseUrl(url),
    referenceTo: (...args: Parameters<ForgeProvider["referenceTo"]>) => local?.referenceTo(...args),
  }
  return provider as unknown as ForgeProvider
}

function localProvider(info: RemoteIndex["providers"][number]): ForgeProvider | undefined {
  try {
    return LOCAL[info.forge]?.({ baseUrl: info.baseUrl, instance: info.instance }).create()
  } catch {
    // Some forges need options the proxy doesn't share, such as an organisation; their helpers go without.
    return undefined
  }
}

function isOptions(value: unknown): value is Record<string, unknown> {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    !(value instanceof Date) &&
    !("forge" in value)
  )
}

/** The proxy sends bytes as base64; these verbs resolve with them. */
function decodeBytes(verb: string, args: unknown[], value: unknown): unknown {
  if (verb === "contents.file") {
    const file = value as { encoding: string; content: string | Uint8Array }
    return file.encoding === "binary" && typeof file.content === "string"
      ? { ...file, content: fromBase64(file.content) }
      : file
  }
  if (
    verb === "releases.downloadAsset" &&
    (args[1] as { as?: string } | undefined)?.as === "binary"
  ) {
    return fromBase64(value as string)
  }
  return value
}

/** Rebuilds the error class the proxy reports, with its fields, without running its constructor. */
async function toError(response: Response, origin: object): Promise<Error> {
  const body = (await response.json().catch(() => undefined)) as
    | { error?: { name?: string; message?: string } & Record<string, unknown> }
    | undefined
  const { name = "ForgeApiError", message = response.statusText, ...fields } = body?.error ?? {}
  const Class = ERRORS.get(name)
  if (!Class) {
    return new forges.ForgeApiError(message, response.status, "", origin)
  }
  const error = Reflect.construct(Error, [message], Class) as Error
  return Object.assign(error, forges.reviveDates(fields), { name })
}
