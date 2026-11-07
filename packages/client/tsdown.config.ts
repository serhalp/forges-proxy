import { defineConfig } from "tsdown"

export default defineConfig({
  entry: ["src/remote.ts"],
  platform: "neutral",
  // `engines.node`, as `forges` requires.
  target: "node22.18",
  dts: true,
})
