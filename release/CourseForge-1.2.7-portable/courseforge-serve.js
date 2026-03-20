/**
 * CourseForge Local Server
 * Simple HTTP server to serve the CourseForge webapp locally
 * 
 * Usage: node courseforge-serve.js [webapp_path] [port]
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

// Get webapp path from argument or default
const webappPath = process.argv[2] || process.cwd();
const portArg = process.argv[3];
const defaultPort = 3000;
const host = process.argv[4] || "localhost";

// Package root is one level above the webapp folder.
// pending-update.json is written here by the updater.
const packageRoot = path.dirname(webappPath);

function readJsonFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    console.error(`[CourseForge server] Failed to read JSON file ${filePath}:`, error);
    return null;
  }
}

let port = defaultPort;
if (portArg && !isNaN(portArg)) {
  port = parseInt(portArg, 10);
}

// Ensure webapp path exists
if (!fs.existsSync(webappPath)) {
  console.error(`Error: Webapp path does not exist: ${webappPath}`);
  process.exit(1);
}

// MIME types
const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".eot": "application/vnd.ms-fontobject",
};

// Start server
function startServer(finalPort) {
  const server = http.createServer((req, res) => {
    try {
      const url = new URL(req.url, `http://localhost:${finalPort}`);
      let pathname = url.pathname;

      // ── /api/* routes ──
      if (pathname.startsWith("/api/")) {
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Content-Type", "application/json");
        if (pathname === "/api/update-status") {
          const pendingPath = path.join(packageRoot, "pending-update.json");
          const manifestPath = path.join(packageRoot, "package-manifest.json");
          const raw = readJsonFile(pendingPath);
          const manifest = readJsonFile(manifestPath);
          res.writeHead(200);
          res.end(JSON.stringify({
            available: Boolean(raw && raw.version),
            version: raw?.version || null,
            releaseUrl: raw?.releaseUrl || null,
            stagedAt: raw?.stagedAt || null,
            currentVersion: manifest?.version || null,
          }));
        } else {
          res.writeHead(404);
          res.end(JSON.stringify({ error: "not found" }));
        }
        return;
      }

      // Remove leading slash for file path
      if (pathname.startsWith("/")) {
        pathname = pathname.slice(1);
      }

      // Security: prevent directory traversal
      if (pathname.includes("..")) {
        res.writeHead(400, { "Content-Type": "text/plain" });
        res.end("Bad Request");
        return;
      }

      let filePath = path.join(webappPath, pathname);

      // Check if it's a directory, serve index.html
      if (fs.existsSync(filePath)) {
        const stat = fs.statSync(filePath);
        if (stat.isDirectory()) {
          filePath = path.join(filePath, "index.html");
        }
      } else if (!filePath.includes(".")) {
        // No file extension, try serving as a route (SPA)
        filePath = path.join(webappPath, "index.html");
      }

      // Read and serve file
      if (fs.existsSync(filePath)) {
        const ext = path.extname(filePath).toLowerCase();
        const contentType = mimeTypes[ext] || "application/octet-stream";

        // Set cache headers for better performance
        if (ext === ".html") {
          res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
        } else {
          res.setHeader("Cache-Control", "public, max-age=31536000"); // 1 year
        }

        const content = fs.readFileSync(filePath);
        res.writeHead(200, {
          "Content-Type": contentType,
          "Access-Control-Allow-Origin": "*",
        });
        res.end(content);
      } else {
        // File not found, serve index.html for SPA routing
        const indexPath = path.join(webappPath, "index.html");
        if (fs.existsSync(indexPath)) {
          const content = fs.readFileSync(indexPath);
          res.writeHead(200, {
            "Content-Type": mimeTypes[".html"],
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "no-cache, no-store, must-revalidate",
          });
          res.end(content);
        } else {
          res.writeHead(404, { "Content-Type": "text/plain" });
          res.end("404 Not Found");
        }
      }
    } catch (err) {
      console.error("Request handler error:", err);
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("500 Internal Server Error");
    }
  });

  server.listen(finalPort, host, () => {
    console.log(`CourseForge server running at http://${host}:${finalPort}`);
    console.log(`Serving from: ${webappPath}`);
    console.log(`Package root: ${packageRoot}`);
  });

  server.on("error", (err) => {
    if (err && err.code === "EADDRINUSE") {
      console.error(`Port ${finalPort} is already in use.`);
    } else {
      console.error("Server error:", err);
    }
    process.exit(1);
  });

  // Graceful shutdown
  process.on("SIGTERM", () => {
    console.log("Shutting down server...");
    server.close();
  });

  process.on("SIGINT", () => {
    console.log("Shutting down server...");
    server.close();
  });
}

// Start the server on the requested fixed port.
startServer(port);
