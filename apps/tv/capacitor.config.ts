import type { CapacitorConfig } from "@capacitor/cli";

// La app de TV es una CÁSCARA (WebView): el APK carga la TV liviana remota
// `tv-lite.html` (servida por el backend en Railway), no un bundle local. Por eso
// `server.url` apunta ahí — y vive acá, en la fuente, para que un `cap sync` no lo
// pise. El contenido de `dist/` (webDir) nunca se muestra; existe solo para que
// `cap sync` no falle. Ver ARCHITECTURE.md.
const config: CapacitorConfig = {
  appId: "com.cinefilo.tv",
  appName: "Miru",
  webDir: "dist",
  // Fondo del WebView = violeta de marca. La app de TV es una cáscara que baja
  // tv-lite.html REMOTO: durante esa descarga el WebView pinta su fondo, que por
  // default es negro (se veía un hueco muerto entre el splash nativo y la app).
  // El splash animado del front no puede taparlo porque vive DENTRO de esa página.
  backgroundColor: "#2A0F5C",
  server: {
    url: "https://cinefilo-production.up.railway.app/tv-lite.html",
    androidScheme: "https",
    cleartext: false,
  },
};

export default config;
