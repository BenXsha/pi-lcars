import { defineConfig } from "vite";
import preact from "@preact/preset-vite";

/* `pi-lcars --dev` sets LCARS_API to the port the server actually got (it walks
 * up when 4173 is busy), so the proxy never points at a dead port. */
const api = process.env.LCARS_API || "http://127.0.0.1:4173";

export default defineConfig({
  plugins: [preact()],
  server: { port: 5173, proxy: { "/api": api } },
  build: { outDir: "dist", emptyOutDir: true },
  resolve: { alias: { preact: "preact" } },
});
