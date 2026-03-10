const http = require("http");
const fs = require("fs");
const path = require("path");

const MIME = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".svg": "image/svg+xml",
};

const root = __dirname;

http.createServer((req, res) => {
  const urlPath = req.url.split("?")[0];
  const filePath = path.resolve(root, urlPath === "/" ? "index.html" : urlPath.slice(1));
  if (!filePath.startsWith(root + path.sep) && filePath !== root) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
    } else {
      res.writeHead(200, { "Content-Type": MIME[path.extname(filePath)] || "text/plain" });
      res.end(data);
    }
  });
}).listen(3002, () => console.log("Server running on http://localhost:3002"));
