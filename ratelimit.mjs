// Rate limiting simple por IP (en memoria, por proceso). La API es pública
// con CORS * y varios endpoints llaman servicios pagos (Anthropic/Groq/
// ElevenLabs): sin esto, cualquier script podía generar costo ilimitado desde
// cualquier origen. Módulo aparte para poder testearlo (server-node.mjs hace
// listen y requiere dist/ al importarse).
//
// Tres cubetas por IP y minuto:
//   - general: todo /api/* (menos ping)                         → 90
//   - ai: endpoints que pagan upstream (búsqueda, voz, etc.)    → 20
//   - blurb: /api/tv-blurb (texto por título, pedido por foco)  → 60, aparte
// El blurb va en su propia cubeta y NO suma en la general: navegar 20
// tarjetas en la TV no puede bloquear las búsquedas ni el resto de la API.
// Su costo está acotado (max_tokens 160 + caché 24 h en tv-search.mjs).

export const RATE_WINDOW_MS = 60_000;
export const RATE_MAX_GENERAL = 90;
export const RATE_MAX_AI = 20;
export const RATE_MAX_BLURB = 60;
export const AI_PATHS = new Set([
  "/api/recommend", "/api/tv-search", "/api/tv-home-more",
  "/api/transcribe", "/api/tts", "/api/ask", "/api/orb", "/api/intent",
]);
export const BLURB_PATH = "/api/tv-blurb";

const rateHits = new Map(); // ip → { all: number[], ai: number[], blurb: number[] }

export function clientIp(req) {
  const xf = req.headers["x-forwarded-for"];
  if (typeof xf === "string" && xf.length) return xf.split(",")[0].trim();
  return (req.socket && req.socket.remoteAddress) || "?";
}

/** true = rechazar con 429. `now` es inyectable para tests. */
export function rateLimited(req, urlPath, now) {
  if (urlPath === "/api/ping" || req.method === "OPTIONS") return false;
  const t = typeof now === "number" ? now : Date.now();
  const cut = t - RATE_WINDOW_MS;
  const ip = clientIp(req);
  let rec = rateHits.get(ip);
  if (!rec) { rec = { all: [], ai: [], blurb: [] }; rateHits.set(ip, rec); }
  if (urlPath === BLURB_PATH) {
    rec.blurb = rec.blurb.filter((x) => x > cut);
    rec.blurb.push(t);
    return rec.blurb.length > RATE_MAX_BLURB;
  }
  rec.all = rec.all.filter((x) => x > cut);
  rec.ai = rec.ai.filter((x) => x > cut);
  rec.all.push(t);
  if (AI_PATHS.has(urlPath)) rec.ai.push(t);
  return rec.all.length > RATE_MAX_GENERAL || rec.ai.length > RATE_MAX_AI;
}

/** Barrido cada 5 min de IPs sin actividad (no retiene el proceso). */
export function startRateSweeper() {
  setInterval(() => {
    const cut = Date.now() - RATE_WINDOW_MS;
    for (const [ip, rec] of rateHits) {
      if (!rec.all.some((x) => x > cut) && !rec.blurb.some((x) => x > cut)) rateHits.delete(ip);
    }
  }, 5 * 60_000).unref();
}

/** Solo para tests. */
export function resetRateLimits() { rateHits.clear(); }
