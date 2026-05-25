import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  root: ".",
  base: "./",
  plugins: [react()],
  build: {
    outDir: "dist/renderer",
    emptyOutDir: false,
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      input: "index.html",
      output: {
        manualChunks: {
          react: ["react", "react-dom/client"],
          terminal: ["@xterm/xterm", "@xterm/addon-fit"],
          icons: ["lucide-react"]
        }
      }
    }
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"]
  }
});
