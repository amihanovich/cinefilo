import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    sourcemap: false,
    // WebViews de Android TV suelen ser más viejos que los de celulares —
    // transpilamos a un target más conservador por las dudas.
    target: "es2017",
  },
});
