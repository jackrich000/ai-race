const http = require("http");
const fs = require("fs");
const path = require("path");

const MIME = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
};

const root = __dirname;

http.createServer((req, res) => {
  const filePath = path.join(root, req.url === "/" ? "index.html" : req.url);
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
