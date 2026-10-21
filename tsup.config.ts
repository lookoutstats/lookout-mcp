import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/stdio.ts", "src/http.ts"],
  format: ["esm"],
  target: "node20",
  dts: { entry: ["src/index.ts", "src/http.ts"] },
  clean: true,
  sourcemap: true,
  splitting: true,
});
