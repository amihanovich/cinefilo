import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { toNodeHandler } from "srvx/node";
import serverModule from "./dist/server/server.js";
import { tvSearch, tvHome, tvHomeMore, tvRibbons, tvTop, warmHome } from "./tv-search.mjs";
import { recommend, askAboutTitle, orbRespond, inferIntent } from "./recommend.mjs";
import { Readable } from "node:stream";
import { transcribeAudio } from "./transcribe.mjs";
import { ttsStream } from "./tts.mjs";
import { startSupabaseKeepAlive } from "./keepalive.mjs";
import { availabilityStatus } from "./availability.mjs";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const clientDir = path.join(__dirname, "dist", "client");

const MIME = {
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".css": "text/css",
  ".html": "text/html; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".json": "application/json",
};

const ssrHandler = toNodeHandler((req) => serverModule.fetch(req, {}, {}));
const port = parseInt(process.env.PORT || "3000", 10);

// --- Rate limiting simple por IP (en memoria). La API es pública con CORS *
// y varios endpoints llaman servicios pagos (Anthropic/Groq/ElevenLabs): sin
// esto, cualquier script podía generar costo ilimitado desde cualquier origen.
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_GENERAL = 90; // todo /api/* (menos ping) por IP por minuto
const RATE_MAX_AI = 20; // endpoints que pagan upstream, por IP por minuto
const AI_PATHS = new Set([
  "/api/recommend", "/api/tv-search", "/api/tv-home-more",
  "/api/transcribe", "/api/tts", "/api/ask", "/api/orb", "/api/intent",
]);
const rateHits = new Map(); // ip → { all: number[], ai: number[] }
function clientIp(req) {
  const xf = req.headers["x-forwarded-for"];
  if (typeof xf === "string" && xf.length) return xf.split(",")[0].trim();
  return req.socket.remoteAddress || "?";
}
function rateLimited(req, urlPath) {
  if (urlPath === "/api/ping" || req.method === "OPTIONS") return false;
  const now = Date.now();
  const cut = now - RATE_WINDOW_MS;
  const ip = clientIp(req);
  let rec = rateHits.get(ip);
  if (!rec) { rec = { all: [], ai: [] }; rateHits.set(ip, rec); }
  rec.all = rec.all.filter((t) => t > cut);
  rec.ai = rec.ai.filter((t) => t > cut);
  rec.all.push(now);
  if (AI_PATHS.has(urlPath)) rec.ai.push(now);
  return rec.all.length > RATE_MAX_GENERAL || rec.ai.length > RATE_MAX_AI;
}
setInterval(() => {
  const cut = Date.now() - RATE_WINDOW_MS;
  for (const [ip, rec] of rateHits) {
    if (!rec.all.some((t) => t > cut)) rateHits.delete(ip);
  }
}, 5 * 60_000).unref();

// Lector de body con tope: responde 413 explícito (antes se hacía req.destroy()
// a secas y el cliente veía un error de red genérico). Resuelve null si cortó.
function readBody(req, res, limit) {
  return new Promise((resolve) => {
    let body = "";
    let done = false;
    req.on("data", (c) => {
      if (done) return;
      body += c;
      if (body.length > limit) {
        done = true;
        res.statusCode = 413;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(JSON.stringify({ error: "Payload demasiado grande" }));
        req.destroy();
        resolve(null);
      }
    });
    req.on("end", () => { if (!done) resolve(body); });
    req.on("error", () => { if (!done) { done = true; resolve(null); } });
  });
}
const asJson = (body) => { try { return JSON.parse(body || "{}"); } catch (e) { return {}; } };
// Saneo defensivo de inputs (la API REST es la puerta más expuesta y no tenía
// ningún tope: un "messages" gigante = prompt gigante = costo arbitrario).
const str = (v, n) => (typeof v === "string" ? v.slice(0, n) : null);
const strArr = (v, maxItems, maxLen) =>
  Array.isArray(v)
    ? v.filter((x) => typeof x === "string").slice(0, maxItems).map((x) => x.slice(0, maxLen))
    : [];

console.log(`[static] clientDir = ${clientDir}`);
console.log(`[static] exists = ${fs.existsSync(clientDir)}`);
try {
  console.log(`[static] assets/ = ${fs.readdirSync(path.join(clientDir, "assets")).join(", ")}`);
} catch (e) {
  console.log(`[static] assets/ error: ${e.message}`);
}

http
  .createServer((req, res) => {
    const reqUrl = new URL(req.url, "http://localhost");
    const urlPath = reqUrl.pathname;

    // CORS: las apps Capacitor (móvil y TV) sirven desde el origen virtual
    // https://localhost, así que TODOS los /api/* necesitan permitir el origen.
    // La API es pública y sin cookies/credenciales → "*" es seguro. Preflight
    // (OPTIONS) global para los POST con Content-Type application/json.
    if (urlPath.startsWith("/api/")) {
      res.setHeader("Access-Control-Allow-Origin", "*");
      if (req.method === "OPTIONS") {
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type");
        res.writeHead(204);
        res.end();
        return;
      }
      if (rateLimited(req, urlPath)) {
        res.statusCode = 429;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.setHeader("Retry-After", "30");
        res.end(JSON.stringify({ error: "Demasiadas solicitudes. Esperá un momento." }));
        return;
      }
    }

    // APIs JSON para la TV liviana (navegadores viejos).
    function sendJson(promise, cacheControl) {
      promise
        .then((result) => {
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.setHeader("Cache-Control", cacheControl || "no-store");
          res.end(JSON.stringify(result));
        })
        .catch((e) => {
          // El detalle queda en el log del server; al cliente no se le filtra
          // el mensaje crudo del upstream (traía fragmentos de Anthropic/Groq).
          console.error(`[api] ${urlPath} error:`, (e && e.message) || e);
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(JSON.stringify({ error: "El servicio está teniendo problemas. Probá de nuevo." }));
        });
    }
    if (urlPath === "/api/tv-search") {
      if (req.method === "POST") {
        readBody(req, res, 16384).then((body) => {
          if (body === null) return;
          const p = asJson(body);
          sendJson(tvSearch(
            str(p.q, 300) || "",
            strArr(p.exclude, 60, 120),
            strArr(p.liked, 50, 120),
            strArr(p.disliked, 50, 120),
            strArr(p.platforms, 10, 40),
            str(p.country, 2),
            p.preferRecent === true,
          ));
        });
      } else {
        const q = (reqUrl.searchParams.get("q") || "").slice(0, 300);
        const exclude = (reqUrl.searchParams.get("exclude") || "").split("|").filter(Boolean).slice(0, 60);
        sendJson(tvSearch(q, exclude, [], []));
      }
      return;
    }
    // Diagnóstico de la validación de disponibilidad (sin datos sensibles):
    // ¿el proceso ve TMDB_API_KEY? ¿TMDB responde desde Railway?
    if (urlPath === "/api/availability-status") {
      sendJson(Promise.resolve(availabilityStatus()));
      return;
    }
    // Pósters de las cintas del pairing (livianas: sin IA, solo Discover cacheado).
    if (urlPath === "/api/tv-ribbons") {
      sendJson(tvRibbons(), "public, max-age=300");
      return;
    }
    if (urlPath === "/api/tv-home") {
      // El home es idéntico para todos y se regenera cada 6h: dejar que el
      // browser/CDN lo cachee 5 min evita regolpear el server en cada visita.
      sendJson(tvHome(), "public, max-age=300");
      return;
    }
    // Solo las tiras "Top 5 en X" del home (las consume el móvil): mismo
    // caché de 6h que /api/tv-home, mismo cacheo de borde.
    if (urlPath === "/api/top-platforms") {
      sendJson(tvTop(), "public, max-age=300");
      return;
    }
    if (urlPath === "/api/tv-home-more") {
      readBody(req, res, 16384).then((body) => {
        if (body === null) return;
        const p = asJson(body);
        sendJson(tvHomeMore(strArr(p.exclude, 60, 120), strArr(p.platforms, 10, 40), str(p.country, 2)));
      });
      return;
    }

    // Transcripción de voz via Groq Whisper (recibe audio binario, máx 10MB).
    if (urlPath === "/api/transcribe" && req.method === "POST") {
      res.setHeader("Access-Control-Allow-Origin", "*");
      const chunks = [];
      let size = 0;
      let tooLarge = false;
      req.on("data", (c) => {
        if (tooLarge) return;
        size += c.length;
        if (size > 10 * 1024 * 1024) {
          // 413 explícito antes de cortar: el cliente veía un abort genérico.
          tooLarge = true;
          res.statusCode = 413;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(JSON.stringify({ error: "Audio demasiado grande (máx 10MB)" }));
          req.destroy();
          return;
        }
        chunks.push(c);
      });
      req.on("error", () => {});
      req.on("end", () => {
        if (tooLarge) return;
        const buffer = Buffer.concat(chunks);
        const mimeType = req.headers["content-type"] || "audio/webm";
        sendJson(transcribeAudio(buffer, mimeType));
      });
      return;
    }
    if (urlPath === "/api/transcribe" && req.method === "OPTIONS") {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      res.writeHead(204);
      res.end();
      return;
    }

    // TTS via ElevenLabs, proxied (la API key vive solo en el servidor).
    // Streaming end-to-end: el MP3 se pipea al cliente a medida que ElevenLabs
    // lo sintetiza (antes se esperaba el buffer completo → segundos de silencio).
    // GET con ?text= permite que el cliente apunte audio.src directo a la URL
    // y el <audio> reproduzca progresivamente. POST se mantiene por compat.
    if (urlPath === "/api/tts" && (req.method === "POST" || req.method === "GET")) {
      res.setHeader("Access-Control-Allow-Origin", "*");
      const speak = (text) => {
        ttsStream(text || "")
          .then((upstream) => {
            res.statusCode = 200;
            res.setHeader("Content-Type", "audio/mpeg");
            res.setHeader("Cache-Control", "no-store");
            if (upstream.body) Readable.fromWeb(upstream.body).pipe(res);
            else res.end();
          })
          .catch((e) => {
            console.error("[api] /api/tts error:", (e && e.message) || e);
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ error: "No se pudo generar la voz." }));
          });
      };
      if (req.method === "GET") {
        speak((reqUrl.searchParams.get("text") || "").slice(0, 1200));
      } else {
        readBody(req, res, 16384).then((body) => {
          if (body === null) return;
          speak(str(asJson(body).text, 1200) || "");
        });
      }
      return;
    }
    if (urlPath === "/api/tts" && req.method === "OPTIONS") {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      res.writeHead(204);
      res.end();
      return;
    }

    // Pregunta conversacional sobre un título (no re-recomienda).
    if (urlPath === "/api/ask" && req.method === "POST") {
      res.setHeader("Access-Control-Allow-Origin", "*");
      readBody(req, res, 65536).then((body) => {
        if (body === null) return;
        const p = asJson(body);
        sendJson(askAboutTitle({
          title: str(p.title, 200) || "",
          platform: str(p.platform, 60) || "",
          question: str(p.question, 500) || "",
        }));
      });
      return;
    }
    if (urlPath === "/api/ask" && req.method === "OPTIONS") {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      res.writeHead(204);
      res.end();
      return;
    }

    // Orbe del control: infiere si el usuario quiere preguntar sobre el título
    // centrado o buscar algo nuevo, y responde en consecuencia (una llamada).
    if (urlPath === "/api/orb" && req.method === "POST") {
      res.setHeader("Access-Control-Allow-Origin", "*");
      readBody(req, res, 65536).then((body) => {
        if (body === null) return;
        const p = asJson(body);
        sendJson(orbRespond({
          transcript: str(p.transcript, 600) || "",
          title: str(p.title, 200) || "",
          platform: str(p.platform, 60) || "",
        }));
      });
      return;
    }
    if (urlPath === "/api/orb" && req.method === "OPTIONS") {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      res.writeHead(204);
      res.end();
      return;
    }

    // Intención inferida: texto libre → frase corta para el estado de búsqueda
    // (corre en paralelo con /api/recommend en el cliente).
    if (urlPath === "/api/intent" && req.method === "POST") {
      res.setHeader("Access-Control-Allow-Origin", "*");
      readBody(req, res, 8192).then((body) => {
        if (body === null) return;
        const p = asJson(body);
        sendJson(inferIntent(str(p.text, 500) || "").then((intent) => ({ intent })));
      });
      return;
    }
    if (urlPath === "/api/intent" && req.method === "OPTIONS") {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      res.writeHead(204);
      res.end();
      return;
    }

    // Warmup: ping barato para despertar el server (Railway cold start).
    if (urlPath === "/api/ping") {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Content-Type", "application/json");
      res.end('{"ok":true}');
      return;
    }

    // API REST para la app móvil (Capacitor).
    if (urlPath === "/api/recommend" && req.method === "POST") {
      res.setHeader("Access-Control-Allow-Origin", "*");
      readBody(req, res, 65536).then((body) => {
        if (body === null) return;
        const p = asJson(body);
        // Solo los últimos 20 turnos, cada uno acotado: un historial gigante
        // era prompt gigante → costo/latencia arbitrarios.
        const messages = (Array.isArray(p.messages) ? p.messages : [])
          .slice(-20)
          .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
          .map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }));
        let alt = typeof p.alternativesCount === "number" ? Math.floor(p.alternativesCount) : 4;
        if (!(alt >= 0 && alt <= 14)) alt = 4;
        sendJson(recommend({
          messages,
          platforms: strArr(p.platforms, 10, 40),
          contextHint: str(p.contextHint, 300),
          seasonHint: str(p.seasonHint, 60),
          weatherHint: str(p.weatherHint, 60),
          excludeTitles: strArr(p.excludeTitles, 100, 120),
          alternativesCount: alt,
          country: str(p.country, 2),
        }));
      });
      return;
    }
    if (urlPath === "/api/recommend" && req.method === "OPTIONS") {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      res.writeHead(204);
      res.end();
      return;
    }

    const filePath = path.join(clientDir, urlPath);

    if (urlPath.startsWith("/assets/")) {
      const exists = fs.existsSync(filePath) && fs.statSync(filePath).isFile();
      console.log(`[static] ${urlPath} → ${filePath} exists=${exists}`);
    }

    // Security: prevent path traversal
    if (!filePath.startsWith(clientDir)) {
      res.writeHead(403);
      res.end();
      return;
    }

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath);
      res.setHeader("Content-Type", MIME[ext] || "application/octet-stream");
      if (urlPath.startsWith("/assets/")) {
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      } else if (ext === ".html") {
        // HTML nunca se cachea: así la TV siempre toma la última versión.
        res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
      }
      fs.createReadStream(filePath).pipe(res);
      return;
    }

    ssrHandler(req, res);
  })
  .listen(port, () => {
    console.log(`Server listening on port ${port}`);
    warmHome(); // pre-carga el home en caché para que el primer usuario no espere
    startSupabaseKeepAlive(); // que el free tier no pause el proyecto (pairing)
  });
