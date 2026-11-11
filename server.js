const http = require("http");
const fs = require("fs");
const path = require("path");
const url = require("url");

const PORT = process.env.PORT || 3000;
const BASE_DIR = __dirname;
const DATA_DIR = path.join(BASE_DIR, "data");
const STORE_FILE = path.join(DATA_DIR, "store.json");

// Гарантируем наличие папки для локального хранения данных
if (!fs.existsSync(DATA_DIR)) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch (e) {}
}

// Загрузка локального хранилища синхронизации
function readStore() {
  try {
    if (fs.existsSync(STORE_FILE)) {
      const raw = fs.readFileSync(STORE_FILE, "utf-8");
      return JSON.parse(raw);
    }
  } catch (e) {
    console.error("Ошибка чтения store.json:", e.message);
  }
  return {};
}

// Сохранение в локальное хранилище
function writeStore(data) {
  try {
    fs.writeFileSync(STORE_FILE, JSON.stringify(data, null, 2), "utf-8");
    return true;
  } catch (e) {
    console.error("Ошибка записи store.json:", e.message);
    return false;
  }
}

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  // 1. API СИНХРОНИЗАЦИИ ДАННЫХ (замена облака без Netlify)
  if (pathname === "/api/sync") {
    const key = parsedUrl.query.key;
    if (!key) {
      res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "Missing key parameter" }));
      return;
    }

    if (req.method === "GET") {
      const store = readStore();
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: true, data: store[key] ?? null }));
      return;
    }

    if (req.method === "POST" || req.method === "PUT") {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
        if (body.length > 50 * 1024 * 1024) {
          req.destroy();
        }
      });
      req.on("end", () => {
        try {
          const parsedBody = body ? JSON.parse(body) : null;
          const store = readStore();
          store[key] = parsedBody;
          writeStore(store);
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ ok: true }));
        } catch (err) {
          res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: "Invalid JSON body" }));
        }
      });
      return;
    }

    res.writeHead(405, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  // 2. СТАТИЧЕСКИЕ ФАЙЛЫ
  let reqPath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.join(BASE_DIR, decodeURIComponent(reqPath));

  // Защита от выхода за пределы рабочей директории
  if (!filePath.startsWith(BASE_DIR)) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("403 Forbidden");
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (!err && stats.isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || "application/octet-stream";
      res.writeHead(200, {
        "Content-Type": contentType,
        "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=3600"
      });
      fs.createReadStream(filePath).pipe(res);
      return;
    }

    // 3. SPA ROUTING FALLBACK: отдаём index.html для любых путей приложения
    const indexPath = path.join(BASE_DIR, "index.html");
    fs.readFile(indexPath, (errIndex, content) => {
      if (errIndex) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("404 Not Found");
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(content);
    });
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("==================================================");
  console.log("🚗 Сервис NurPoput успешно запущен локально!");
  console.log(`🌐 Откройте в браузере: http://localhost:${PORT}`);
  console.log("💡 Для завершения работы нажмите Ctrl + C");
  console.log("==================================================");
});
