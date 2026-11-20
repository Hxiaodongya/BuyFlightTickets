import { fileURLToPath } from "node:url";
import path from "node:path";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  base: "./",
  plugins: [vue()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        dashboard: path.resolve(projectRoot, "src/dashboard/index.html"),
      },
    },
  },
});
