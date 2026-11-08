import type { KnipConfig } from "knip"

export default {
  workspaces: {
    ".": {
      // The Netlify Edge bundler resolves the demo's import from the root.
      ignoreDependencies: ["@forges-proxy/server"],
      ignoreBinaries: ["zizmor"],
    },
    // Entries the platforms find by convention, which knip has no plugin for.
    "packages/server": { entry: ["dev.ts"] },
    "demos/cloudflare-workers": {
      entry: ["cloudflare.config.ts", "src/index.ts"],
      // `cf` bundles with it.
      ignoreDependencies: ["wrangler"],
    },
    "demos/netlify-edge": { entry: ["netlify/edge-functions/*.ts"] },
    "demos/nitro": { entry: ["server/routes/**/*.ts"] },
    "demos/vercel": { entry: ["api/*.ts"] },
  },
} satisfies KnipConfig
