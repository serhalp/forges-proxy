import { afterEach, beforeEach, mock } from "node:test"
import type { Forges } from "forges"
import { H3 } from "nitro/h3"

/**
 * The proxy's middleware and routes on an in-process h3 app, serving `forges` instead of providers from the env.
 * Mocks the providers module, so call it once per test file, before anything imports the server.
 */
export async function createProxy(forges: Forges): Promise<H3> {
  mock.module(new URL("../../server/utils/forges.ts", import.meta.url).href, {
    exports: {
      useForges: () => forges,
      skippedProviders: () => [{ forge: "GITLAB", suffix: "", reason: "needs TOKEN" }],
    },
  })
  const { default: auth } = await import("#server/middleware/auth.ts")
  const { default: index } = await import("#server/routes/v1/index.get.ts")
  const { default: verb } = await import("#server/routes/v1/[forge]/[instance]/[verb].ts")
  return new H3().use(auth).get("/v1", index).all("/v1/:forge/:instance/:verb", verb)
}

/** Sets env vars around each test of the enclosing suite. */
export function env(vars: Record<string, string>): void {
  beforeEach(() => Object.assign(process.env, vars))
  afterEach(() => {
    for (const key of Object.keys(vars)) delete process.env[key]
  })
}
