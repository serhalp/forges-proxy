import { afterEach, beforeEach } from "node:test"
import type { Forges } from "forges"
import type { Server, ServerOptions } from "#src/index.ts"
import { createServer } from "#src/index.ts"

/** What the proxy under test purged and expired, since the last reset. */
export const recorded = { purges: [] as string[][], expiries: 0 }

/**
 * The proxy serving `forges` instead of providers from the env, and recording purges and upstream expiries. Reads the
 * env on every request, so suites can switch modes with `env()`.
 */
export function createProxy(forges: Forges, options: ServerOptions = {}): Server {
  beforeEach(() => {
    recorded.purges = []
    recorded.expiries = 0
  })
  return createServer({
    forges,
    upstream: Object.assign(fetch, { expire: () => void recorded.expiries++ }),
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
