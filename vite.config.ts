/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import preact from "@preact/preset-vite";

export default defineConfig({
  plugins: [preact()],
  server: { port: 5173, strictPort: true, host: "localhost" },
  preview: { port: 4173, strictPort: true, host: "localhost" },
  test: { include: ["tests/**/*.test.ts"], environment: "node" },
});
