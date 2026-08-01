import path from "node:path"
import { fileURLToPath } from "node:url"
import { transformAsync } from "@babel/core"
import locatorJsx from "@locator/babel-jsx"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

const rootDir = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig(({ mode }) => ({
  plugins: [
    mode === "development" && {
      name: "draftly-locator-jsx",
      enforce: "pre",
      async transform(code: string, id: string) {
        if (!/\.[jt]sx$/.test(id) || id.includes("node_modules")) return null
        const result = await transformAsync(code, {
          filename: id,
          cwd: rootDir,
          babelrc: false,
          configFile: false,
          sourceMaps: true,
          parserOpts: {
            plugins: ["jsx", "typescript"],
          },
          plugins: [[locatorJsx, { env: "development" }]],
        })
        return result?.code ? { code: result.code, map: result.map } : null
      },
    },
    react(),
    tailwindcss(),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(rootDir, "src"),
    },
  },
}))
