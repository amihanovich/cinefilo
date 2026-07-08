import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.cinefilo.tv",
  appName: "Cinéfilo TV",
  webDir: "dist",
  server: {
    androidScheme: "https",
    // Carga directo la TV de Carlos ya desplegada (public/tv-lite.html en la
    // raíz del repo, servida por server-node.mjs) en vez del bundle propio de
    // este proyecto (src/). El WebView navega a esta URL; dist/ no se usa en
    // runtime pero Capacitor igual lo requiere para `cap sync`.
    url: "https://cinefilo-production.up.railway.app/tv-lite.html",
  },
};

export default config;
