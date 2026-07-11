import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { toNodeHandler } from "srvx/node";
import serverModule from "./dist/server/server.js";
import { tvSearch, tvHome, tvHomeMore, warmHome } from "./tv-search.mjs";
import { recommend, askAboutTitle, orbRespond, inferIntent } from "./recommend.mjs";
import { transcribeAudio } from "./transcribe.mjs";
import { ttsAudio } from "./tts.mjs";

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
    }

    // APIs JSON para la TV liviana (navegadores viejos).
    function sendJson(promise) {
      promise
        .then((result) => {
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.setHeader("Cache-Control", "no-store");
          res.end(JSON.stringify(result));
        })
        .catch((e) => {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(JSON.stringify({ error: String((e && e.message) || e) }));
        });
    }
    if (urlPath === "/api/tv-search") {
      if (req.method === "POST") {
        let body = "";
        req.on("data", (c) => { body += c; });
        req.on("end", () => {
          let p = {};
          try { p = JSON.parse(body || "{}"); } catch (e) { p = {}; }
          sendJson(tvSearch(p.q || "", p.exclude || [], p.liked || [], p.disliked || []));
        });
      } else {
        const q = reqUrl.searchParams.get("q") || "";
        const exclude = (reqUrl.searchParams.get("exclude") || "").split("|").filter(Boolean);
        sendJson(tvSearch(q, exclude, [], []));
      }
      return;
    }
    if (urlPath === "/api/tv-home") {
      sendJson(tvHome());
      return;
    }
    if (urlPath === "/api/tv-home-more") {
      let body = "";
      req.on("data", (c) => { body += c; });
      req.on("end", () => {
        let p = {};
        try { p = JSON.parse(body || "{}"); } catch (e) { p = {}; }
        sendJson(tvHomeMore(p.exclude || []));
      });
      return;
    }

    // Transcripción de voz via Groq Whisper (recibe audio binario, máx 10MB).
    if (urlPath === "/api/transcribe" && req.method === "POST") {
      res.setHeader("Access-Control-Allow-Origin", "*");
      const chunks = [];
      let size = 0;
      req.on("data", (c) => {
        size += c.length;
        if (size > 10 * 1024 * 1024) { req.destroy(); return; }
        chunks.push(c);
      });
      req.on("end", () => {
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
    if (urlPath === "/api/tts" && req.method === "POST") {
      res.setHeader("Access-Control-Allow-Origin", "*");
      let body = "";
      req.on("data", (c) => { body += c; if (body.length > 16384) req.destroy(); });
      req.on("end", () => {
        let p = {};
        try { p = JSON.parse(body || "{}"); } catch (e) { p = {}; }
        ttsAudio(p.text || "")
          .then((buffer) => {
            res.setHeader("Content-Type", "audio/mpeg");
            res.setHeader("Cache-Control", "no-store");
            res.end(buffer);
          })
          .catch((e) => {
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ error: String((e && e.message) || e) }));
          });
      });
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
      let body = "";
      req.on("data", (c) => { body += c; if (body.length > 65536) req.destroy(); });
      req.on("end", () => {
        let p = {};
        try { p = JSON.parse(body || "{}"); } catch (e) { p = {}; }
        sendJson(askAboutTitle({
          title: p.title || "",
          platform: p.platform || "",
          question: p.question || "",
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
      let body = "";
      req.on("data", (c) => { body += c; if (body.length > 65536) req.destroy(); });
      req.on("end", () => {
        let p = {};
        try { p = JSON.parse(body || "{}"); } catch (e) { p = {}; }
        sendJson(orbRespond({
          transcript: p.transcript || "",
          title: p.title || "",
          platform: p.platform || "",
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
      let body = "";
      req.on("data", (c) => { body += c; if (body.length > 8192) req.destroy(); });
      req.on("end", () => {
        let p = {};
        try { p = JSON.parse(body || "{}"); } catch (e) { p = {}; }
        sendJson(inferIntent(p.text || "").then((intent) => ({ intent })));
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
      let body = "";
      req.on("data", (c) => { body += c; });
      req.on("end", () => {
        let p = {};
        try { p = JSON.parse(body || "{}"); } catch (e) { p = {}; }
        sendJson(recommend({
          messages: p.messages || [],
          platforms: p.platforms || [],
          contextHint: p.contextHint || null,
          seasonHint: p.seasonHint || null,
          weatherHint: p.weatherHint || null,
          excludeTitles: p.excludeTitles || [],
          alternativesCount: typeof p.alternativesCount === "number" ? p.alternativesCount : 4,
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
  });
