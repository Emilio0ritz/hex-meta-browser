import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const host = "127.0.0.1";
const port = Number.parseInt(process.env.PORT || process.argv[2] || "8765", 10);
const previewUrl = `http://${host}:${port}/?preview=annotation`;
const previewScript = '<script src="preview-state.js"></script>';
const appScript = '<script src="app.js"></script>';

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".md": "text/plain; charset=utf-8"
};

function send(response, status, body, contentType = "text/plain; charset=utf-8") {
  response.writeHead(status, {
    "Content-Type": contentType,
    "Cache-Control": "no-store, max-age=0",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(body);
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url || "/", `http://${host}:${port}`);
  if (url.pathname === "/__hex_preview__/health") {
    send(response, 200, JSON.stringify({ ok: true, previewUrl }), contentTypes[".json"]);
    return;
  }

  const requested = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1));
  const filePath = path.resolve(root, requested);
  const relativePath = path.relative(root, filePath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    send(response, 403, "Forbidden");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      send(response, 404, "Not found");
      return;
    }

    if (requested === "index.html") {
      const html = data.toString("utf8");
      if (!html.includes(appScript)) {
        send(response, 500, "HEX preview could not locate the renderer entry point.");
        return;
      }
      send(response, 200, html.replace(appScript, `${previewScript}\n    ${appScript}`), contentTypes[".html"]);
      return;
    }

    send(response, 200, data, contentTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream");
  });
});

server.listen(port, host, () => {
  console.log(`HEX annotation preview running at ${previewUrl}`);
});

server.on("error", error => {
  if (error.code === "EADDRINUSE") {
    console.error(`Port ${port} is already in use. Set PORT to launch the HEX preview on another port.`);
  } else {
    console.error(error);
  }
  process.exitCode = 1;
});

function closeServer() {
  server.close(() => process.exit(0));
}

process.on("SIGINT", closeServer);
process.on("SIGTERM", closeServer);
