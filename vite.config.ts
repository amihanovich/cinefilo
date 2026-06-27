// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, cloudflare (build-only),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... } }) if needed.
import { existsSync, readFileSync } from "node:fs";
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// HTTPS de desarrollo con certificado self-signed (en .certs/, gitignoreado).
// Solo se activa si los archivos existen → para el equipo/CI que no los tiene,
// el server sigue en http normal (sin romper nada). Necesario para probar desde
// un celular real: el micrófono y crypto.randomUUID requieren "contexto seguro".
const httpsConfig =
  existsSync(".certs/cert.pem") && existsSync(".certs/key.pem")
    ? { key: readFileSync(".certs/key.pem"), cert: readFileSync(".certs/cert.pem") }
    : undefined;

// cloudflare: false → skips @cloudflare/vite-plugin so TanStack Start builds
// with the default Node.js adapter (Vinxi/Nitro). Required for Railway deployment.
// For local dev with Lovable keep cloudflare: false — it only affects the build target.
export default defineConfig({
  cloudflare: false,
  tanstackStart: {
    server: { entry: "server" },
  },
  // allowedHosts: permitir acceso por IP de LAN / túnel en dev.
  vite: {
    server: {
      allowedHosts: true,
      ...(httpsConfig ? { https: httpsConfig } : {}),
    },
    // Compatibilidad con navegadores de TVs antiguas (Tizen/webOS): transpilar
    // la sintaxis moderna (?., ??, etc.) a JS más viejo que esos navegadores sí
    // entienden. Cubre TVs ~2018-2019; las muy viejas pueden necesitar más.
    build: {
      target: "es2015",
    },
  },
});
