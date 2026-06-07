import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "/bolao-copa-2026/",   // nome do repositório GitHub
  build: {
    outDir: "dist",
  },
});
