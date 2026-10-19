import { afterEach, beforeEach, mock } from "node:test"
import type { Forges } from "forges"
import { H3 } from "nitro/h3"

/** What the proxy under test purged and expired, since the last reset. */
export const recorded = { purges: [] as string[][], expiries: 0 }

/**
 * The proxy's middleware and routes on an in-process h3 app, serving `forges` instead of providers from the env, and
 * recording purges instead of calling a CDN. Mocks modules, so call it once per test file, before anything imports the
 * server.
 */
export async function createProxy(forges: Forges): Promise<H3> {
  mock.module(new URL("../../server/utils/forges.ts", import.meta.url).href, {
    exports: {
      useForges: () => forges,
      expireUpstream: () => recorded.expiries++,
      skippedProviders: () => [{ forge: "GITLAB", suffix: "", reason: "needs TOKEN" }],
    },
  })
  mock.module(new URL("../../server/utils/purge.ts", import.meta.url).href, {
    exports: { usePurge: () => async (tags: string[]) => void recorded.purges.push(tags) },
  })
  beforeEach(() => {
    recorded.purges = []
    recorded.expiries = 0
  })
  const { default: auth } = await import("#server/middleware/auth.ts")
  const { default: index } = await import("#server/routes/v1/index.get.ts")
  const { default: status } = await import("#server/routes/v1/status.get.ts")
  const { default: verb } = await import("#server/routes/v1/[forge]/[instance]/[verb].ts")
  const { default: webhook } = await import("#server/routes/webhooks/[forge]/[instance].post.ts")
  return new H3()
    .use(auth)
    .get("/v1", index)
    .get("/v1/status", status)
    .all("/v1/:forge/:instance/:verb", verb)
    .post("/webhooks/:forge/:instance", webhook)
}

/** Sets env vars around each test of the enclosing suite. */
export function env(vars: Record<string, string>): void {
  beforeEach(() => Object.assign(process.env, vars))
  afterEach(() => {
    for (const key of Object.keys(vars)) delete process.env[key]
  })
}
