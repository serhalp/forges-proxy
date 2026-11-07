import { bindings, defineConfig } from "cf/config"

export default defineConfig({
  worker: {
    name: "demo",
    entrypoint: "src/index.ts",
    compatibilityDate: "2026-10-01",
    // For `node:async_hooks`, and a `process.env` filled from the bindings below, which the server reads.
    compatibilityFlags: ["nodejs_compat"],
    env: {
      FORGES_PROXY_PUBLIC: bindings.text("1"),
      // `cf deploy --secrets-file <file>`; locally, `.dev.vars`.
      FORGES_GITHUB_TOKEN: bindings.secret(),
    },
  },
})
