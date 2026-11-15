import type { ForgeProvider } from "forges"
import type { VerbSignature } from "forges/schema"
import type { AccessMode } from "./access.ts"
import type { Env } from "./context.ts"

/**
 * Signs the `nextUrl` of the cursors a public instance hands out and refuses unsigned ones, so callers can page through
 * the listings the forge returned but can't aim an authenticated provider at any other path of its API. Private
 * instances trust their callers, and anonymous providers have no credential to misuse.
 */
export function signsCursors(mode: AccessMode, provider: ForgeProvider): boolean {
  return mode === "public" && provider.authKind !== "anonymous"
}

/**
 * The signing key, derived from the forge credentials in the env, so that every server instance of a deployment
 * agrees on it without another secret to configure. Without any (providers passed in directly), a key of this server
 * instance's own.
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

/** A listing's page with its cursor's `nextUrl` signed for `scope` (the forge and instance). */
export async function signPage(page: unknown, key: CryptoKey, scope: string): Promise<unknown> {
  const cursor = cursorOf(page)
  if (!isObject(page) || typeof cursor?.nextUrl !== "string") {
    return page
  }
  const signature = await sign(key, scope, cursor.nextUrl)
  return { ...page, cursor: { ...cursor, signature } }
}

/** Why the options' cursor can't be used: a `nextUrl` this instance didn't sign for `scope`. */
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
