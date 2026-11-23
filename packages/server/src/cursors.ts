import type { ForgeProvider } from "forges"
import type { VerbSignature } from "forges/schema"
import type { AccessMode } from "./access.ts"
import type { Env } from "./context.ts"

/**
 * Returns true when pagination cursors must be signed. On public instances with authenticated
 * providers, `cursor.nextUrl` is HMAC-signed so callers cannot pass an arbitrary upstream API path
 * to be fetched with the proxy's token.
 */
export function signsCursors(mode: AccessMode, provider: ForgeProvider): boolean {
  return mode === "public" && provider.authKind !== "anonymous"
}

/**
 * Derives an HMAC signing key via HKDF from the configured `FORGES_*` credential env vars so all
 * serverless instances share the same key without extra configuration. Falls back to random bytes
 * when providers were passed programmatically without env vars.
 */
export async function cursorKey(env: Env): Promise<CryptoKey> {
  const material = Object.entries(env)
    .filter(([name]) => name.startsWith("FORGES_") && !name.startsWith("FORGES_PROXY_"))
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([name, value]) => `${name}=${value ?? ""}`)
    .join("\n")
  const secret = material
    ? new TextEncoder().encode(material)
    : crypto.getRandomValues(new Uint8Array(32))
  const base = await crypto.subtle.importKey("raw", secret, "HKDF", false, ["deriveKey"])
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(),
      info: new TextEncoder().encode("forges-proxy cursor"),
    },
    base,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  )
}

/** Attaches an HMAC signature to `page.cursor.nextUrl` scoped to `scope` (`<forge>:<instance>`). */
export async function signPage(page: unknown, key: CryptoKey, scope: string): Promise<unknown> {
  const cursor = cursorOf(page)
  if (!isObject(page) || typeof cursor?.nextUrl !== "string") {
    return page
  }
  const signature = await sign(key, scope, cursor.nextUrl)
  return { ...page, cursor: { ...cursor, signature } }
}

/**
 * Verifies the signature on `cursor.nextUrl` if present in `args`. Returns an error message when
 * the signature is missing or invalid.
 */
export async function unsignedCursor(
  verb: VerbSignature,
  args: unknown[],
  key: CryptoKey,
  scope: string,
): Promise<string | undefined> {
  const index = verb.params.findIndex((param) => param.options)
  const cursor = index < 0 ? undefined : cursorOf(args[index])
  if (typeof cursor?.nextUrl !== "string") {
    return undefined
  }
  const signature = typeof cursor.signature === "string" ? decode(cursor.signature) : undefined
  const valid =
    signature &&
    (await crypto.subtle.verify("HMAC", key, signature, message(scope, cursor.nextUrl)))
  return valid ? undefined : "The cursor's `nextUrl` must come from this proxy's own response"
}

async function sign(key: CryptoKey, scope: string, nextUrl: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, message(scope, nextUrl)))
  return btoa(String.fromCharCode(...bytes))
}

function message(scope: string, nextUrl: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(`${scope}\n${nextUrl}`)
}

function decode(signature: string): Uint8Array<ArrayBuffer> | undefined {
  try {
    return Uint8Array.from(atob(signature), (char) => char.charCodeAt(0))
  } catch {
    return undefined
  }
}

function cursorOf(value: unknown): Record<string, unknown> | undefined {
  return isObject(value) && isObject(value.cursor) ? value.cursor : undefined
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
