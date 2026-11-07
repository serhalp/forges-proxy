import { defineConfig } from "tsdown"

export default defineConfig({
  entry: ["src/index.ts"],
  platform: "neutral",
  // `engines.node`, as `forges` requires.
  target: "node22.18",
  // Workers and Deno provide these through their Node compatibility.
  deps: { neverBundle: [/^node:/] },
  dts: true,
  tsconfig: "tsconfig.build.json",
})
