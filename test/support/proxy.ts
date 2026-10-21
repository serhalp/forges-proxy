import { afterEach, beforeEach, mock } from "node:test"
import type { Forges } from "forges"
import { readdirSync } from "node:fs"
import { join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import type { HTTPMethod } from "nitro/h3"
import { H3 } from "nitro/h3"

/** What the proxy under test purged and expired, since the last reset. */
export const recorded = { purges: [] as string[][], expiries: 0 }

/**
 * The proxy's middleware and routes on an in-process h3 app, found as Nitro finds them, serving `forges` instead of providers from the env, and
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
  const app = new H3()
  for (const file of readdirSync(new URL("middleware", SERVER), { recursive: true })) {
    app.use((await import(new URL(`middleware/${file}`, SERVER).href)).default)
  }
  for (const file of routeFiles()) {
    const { method, path } = routeOf(file)
    const { default: handler } = await import(new URL(`routes/${file}`, SERVER).href)
    app.on(method, path, handler)
  }
  return app
}

const SERVER = new URL("../../server/", import.meta.url)

function routeFiles(): string[] {
  return readdirSync(new URL("routes", SERVER), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) =>
      relative(fileURLToPath(new URL("routes", SERVER)), join(entry.parentPath, entry.name)),
    )
}

/** Nitro's file routing: `v1/[forge]/index.get.ts` is `GET /v1/:forge`, and no method suffix takes every method. */
function routeOf(file: string): { method: HTTPMethod | ""; path: string } {
  const [, base, method] = /^(.*?)(?:\.(get|post|put|patch|delete))?\.ts$/.exec(file)!
  const path = `/${base!}`.replace(/\[(\w+)\]/g, ":$1").replace(/\/index$/, "")
  return { method: (method?.toUpperCase() ?? "") as HTTPMethod | "", path: path || "/" }
}

/** Sets env vars around each test of the enclosing suite. */
export function env(vars: Record<string, string>): void {
  beforeEach(() => Object.assign(process.env, vars))
  afterEach(() => {
    for (const key of Object.keys(vars)) delete process.env[key]
  })
}
