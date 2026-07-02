const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const DOWNLOADS_DIR = path.join(ROOT, "downloads");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".apk": "application/vnd.android.package-archive",
};

// Nombres fijos: para publicar una versión nueva alcanza con reemplazar
// el archivo en downloads/ (mismo nombre) y hacer push. El link nunca cambia.
const LATEST_APK_ROUTES = {
  "/download/android": "cinefilo-mobile.apk",
  "/download/androidtv": "cinefilo-tv.apk",
};

function sendFile(res, filePath, downloadName) {
  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Todavía no hay una versión disponible para descargar.");
      return;
    }
    const headers = {
      "Content-Type": MIME_TYPES[path.extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-cache",
    };
    if (downloadName) {
      headers["Content-Disposition"] = `attachment; filename="${downloadName}"`;
    }
    res.writeHead(200, headers);
    fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);

  const apkFile = LATEST_APK_ROUTES[urlPath];
  if (apkFile) {
    sendFile(res, path.join(DOWNLOADS_DIR, apkFile), apkFile);
    return;
  }

  const requestedPath = path.normalize(urlPath === "/" ? "/index.html" : urlPath);
  const filePath = path.join(ROOT, requestedPath);

  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("No encontrado");
      return;
    }
    res.writeHead(200, { "Content-Type": MIME_TYPES[path.extname(filePath)] || "application/octet-stream" });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`Landing de Cinéfilo escuchando en el puerto ${PORT}`);
});
