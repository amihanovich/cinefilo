// Servidor estático mínimo para servir la APP MÓVIL COMO WEB en Railway (o
// cualquier host Node): el mismo bundle que Capacitor empaqueta en el APK,
// servido en una URL. Sirve dist/ con fallback a index.html (ruteo SPA). Sin
// dependencias: usa solo el http/fs de Node. (Copiado de apps/web-control.)

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const distDir = path.join(__dirname, "dist");
const port = parseInt(process.env.PORT || "3000", 10);

// /api/* → el backend por la red PRIVADA de Railway (ej.
// http://miru-ai.railway.internal:8080). Así el backend no necesita URL
// pública: la web (www.mirumovies.com) es lo único expuesto. Para eso el build
// de la web va con VITE_API_BASE_URL=https://www.mirumovies.com (mismo origen).
// Sin API_UPSTREAM no se reenvía nada (como antes).
const API_UPSTREAM = process.env.API_UPSTREAM ? new URL(process.env.API_UPSTREAM) : null;

function proxyApi(req, res) {
  const headers = { ...req.headers, host: API_UPSTREAM.host };
  // La IP real del usuario viaja para que el rate limit del backend no meta a
  // todos en la misma bolsa.
  const ip = req.socket.remoteAddress || "";
  if (!headers["x-forwarded-for"] && ip) headers["x-forwarded-for"] = ip;
  const upstream = http.request({
    protocol: API_UPSTREAM.protocol,
    hostname: API_UPSTREAM.hostname,
    port: API_UPSTREAM.port || 80,
    method: req.method,
    path: req.url,
    headers,
    timeout: 90000,
  }, (up) => {
    res.writeHead(up.statusCode || 502, up.headers);
    up.pipe(res);
  });
  upstream.on("timeout", () => upstream.destroy(new Error("timeout")));
  upstream.on("error", (e) => {
    console.warn("[api-proxy]", e.message);
    if (!res.headersSent) res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "El servidor de Miru no responde." }));
  });
  req.pipe(upstream);
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
  ".json": "application/json",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function sendFile(res, filePath) {
  const ext = path.extname(filePath);
  res.setHeader("Content-Type", MIME[ext] || "application/octet-stream");
  if (filePath.includes(`${path.sep}assets${path.sep}`)) {
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  } else if (ext === ".html") {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  }
  fs.createReadStream(filePath).pipe(res);
}

http
  .createServer((req, res) => {
    const urlPath = new URL(req.url, "http://localhost").pathname;
    if (API_UPSTREAM && urlPath.startsWith("/api/")) {
      proxyApi(req, res);
      return;
    }
    const filePath = path.join(distDir, urlPath);

    // Anti path traversal.
    if (!filePath.startsWith(distDir)) {
      res.writeHead(403);
      res.end();
      return;
    }

    if (urlPath !== "/" && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      sendFile(res, filePath);
      return;
    }

    // SPA fallback: cualquier otra ruta → index.html.
    sendFile(res, path.join(distDir, "index.html"));
  })
  .listen(port, () => {
    console.log(`miru-web listening on port ${port}`);
  });
