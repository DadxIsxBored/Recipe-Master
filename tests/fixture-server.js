"use strict";

const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const fixturePath = path.join(__dirname, "fixtures", "recipe-page.html");
const fixture = fs.readFileSync(fixturePath);

http.createServer((_request, response) => {
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  response.end(fixture);
}).listen(8765, "127.0.0.1", () => {
  process.stdout.write("Fixture server listening on http://127.0.0.1:8765\n");
});
