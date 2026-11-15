import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";

// Monorepo root holds `.env` / `.env.example`. Vite does not walk parent
// directories, so without this the web package never sees VITE_GROQ_API_KEY.
const envDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export default defineConfig({
  plugins: [tailwindcss()],
  envDir,
  build: {
    outDir: "dist",
  },
});
