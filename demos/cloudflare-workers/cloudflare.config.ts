import { bindings, defineConfig } from "cf/config"

export default defineConfig({
  worker: {
    name: "demo",
    entrypoint: "src/index.ts",
    compatibilityDate: "2026-10-01",
    // Required for `node:async_hooks` and populating `process.env` from Worker bindings.
    compatibilityFlags: ["nodejs_compat"],
    env: {
      FORGES_PROXY_PUBLIC: bindings.text("1"),
      // Set via `cf deploy --secrets-file <file>` or `.dev.vars` locally.
      FORGES_GITHUB_TOKEN: bindings.secret(),
    },
  },
})
