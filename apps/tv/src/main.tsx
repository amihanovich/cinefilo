// Miru TV es una CÁSCARA (WebView): el APK carga la TV liviana remota
// `tv-lite.html` (ver `server.url` en capacitor.config.ts). Este bundle NUNCA se
// muestra en el APK; existe solo para que `vite build` + `cap sync` tengan un
// `dist/` válido. Por eso acá no hay una SPA: solo un placeholder mínimo.
const root = document.getElementById("root");
if (root) {
  root.textContent = "Cargando Miru TV…";
  root.style.cssText =
    "display:flex;align-items:center;justify-content:center;height:100vh;margin:0;font-family:system-ui,sans-serif;background:#0b0b0f;color:#e5e5e5;";
}
