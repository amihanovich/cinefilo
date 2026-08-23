// Servidor estático mínimo para servir la landing en Railway (o cualquier host
// Node). Sirve dist/ y hace fallback a index.html para el ruteo SPA. Sin
// dependencias: usa solo el http/fs de Node.
//
// Además expone atajos de descarga que redirigen al APK del manifest:
//   /tv  → APK de la app de TV     (el usuario la tipea con el control remoto)
//   /app → APK de la app de celular
// La URL real del APK vive en Supabase Storage y es larguísima; estos atajos
// son lo que hace viable el sideload en un televisor, que no tiene cámara para
// leer un QR ni teclado para escribir una URL larga.

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const distDir = path.join(__dirname, "dist");
const port = parseInt(process.env.PORT || "3000", 10);
const manifestUrl = process.env.VITE_MANIFEST_URL || process.env.MANIFEST_URL;

// Atajo → app del manifest.
const SHORTCUTS = {
  "/tv": "tv",
  "/tv.apk": "tv",
  "/app": "mobile-android",
  "/app.apk": "mobile-android",
  "/android": "mobile-android",
};

// El manifest cambia solo cuando se publica una build: alcanza con un cache
// corto en memoria para no pegarle a Supabase en cada request.
const MANIFEST_TTL_MS = 60_000;
let manifestCache = { at: 0, data: null };

async function apkUrlFor(appKey) {
  if (!manifestUrl) return null;
  const now = Date.now();
  if (!manifestCache.data || now - manifestCache.at > MANIFEST_TTL_MS) {
    try {
      const res = await fetch(manifestUrl);
      if (!res.ok) throw new Error(`manifest ${res.status}`);
      manifestCache = { at: now, data: await res.json() };
    } catch (err) {
      console.error("no se pudo leer el manifest:", err.message);
      if (!manifestCache.data) return null; // sin cache previa, no hay a dónde ir
    }
  }
  return manifestCache.data?.apps?.[appKey]?.url ?? null;
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
  ".apk": "application/vnd.android.package-archive",
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
  .createServer(async (req, res) => {
    const urlPath = new URL(req.url, "http://localhost").pathname;

    const shortcut = SHORTCUTS[urlPath.replace(/\/+$/, "").toLowerCase() || "/"];
    if (shortcut) {
      const url = await apkUrlFor(shortcut);
      if (url) {
        res.writeHead(302, { Location: url, "Cache-Control": "no-store" });
        res.end();
      } else {
        res.writeHead(503, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("No hay una version publicada todavia.");
      }
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
    console.log(`landing listening on port ${port}`);
  });
