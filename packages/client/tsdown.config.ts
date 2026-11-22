import { defineConfig } from "tsdown"

export default defineConfig({
  entry: ["src/remote.ts", "src/all.ts"],
  platform: "neutral",
  // `engines.node`, as `forges` requires.
  target: "node22.18",
  // Oxc needs every export annotated, and spares us TypeScript's API.
  dts: { generator: "oxc" },
})
