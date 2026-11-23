import { afterEach, beforeEach } from "node:test"
import type { Forges } from "forges"
import type { Server, ServerOptions } from "../../src/index.ts"
import { createServer } from "../../src/index.ts"

/** Cache tags purged during the current test. */
export const recorded = { purges: [] as string[][] }

/**
 * Creates a test proxy serving `forges` and recording cache tag purges in `recorded.purges`.
 * Reads `process.env` per request so test suites can switch access modes with `env()`.
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

/** Sets environment variables before each test in the enclosing suite and restores them after. */
export function env(vars: Record<string, string>): void {
  beforeEach(() => Object.assign(process.env, vars))
  afterEach(() => {
    for (const key of Object.keys(vars)) delete process.env[key]
  })
}
