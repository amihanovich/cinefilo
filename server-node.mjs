import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { toNodeHandler } from "srvx/node";
import serverModule from "./dist/server/server.js";
import { tvSearch, tvHome, tvHomeMore, warmHome } from "./tv-search.mjs";

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
