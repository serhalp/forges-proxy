import { afterEach, beforeEach } from "node:test"
import type { Forges } from "forges"
import type { Server, ServerOptions } from "#src/index.ts"
import { createServer } from "#src/index.ts"

/** What the proxy under test purged, since the last reset. */
export const recorded = { purges: [] as string[][] }

/**
 * The proxy serving `forges` instead of providers from the env, and recording purges. Reads the
 * env on every request, so suites can switch modes with `env()`.
 */
export function createProxy(forges: Forges, options: ServerOptions = {}): Server {
  beforeEach(() => {
    recorded.purges = []
  })
  return createServer({
    forges,
    purge: async (tags) => void recorded.purges.push(tags),
    ...options,
  })
}

/** Sets env vars around each test of the enclosing suite. */
export function env(vars: Record<string, string>): void {
  beforeEach(() => Object.assign(process.env, vars))
  afterEach(() => {
    for (const key of Object.keys(vars)) delete process.env[key]
  })
}
