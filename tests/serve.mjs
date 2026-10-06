import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = fileURLToPath(new URL("..", import.meta.url));
const output = path.join(root, ".cache/flowchart-test/site");
execFileSync(process.execPath, ["scripts/build.mjs",
  "--site", "tests/fixtures/site.json", "--content", "tests/fixtures/content",
  "--assets", "assets", "--out", output,
], { cwd: root, stdio: "inherit" });

const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml" };
createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    if (!url.pathname.startsWith("/docs/")) throw new Error("Unknown route");
    const file = path.resolve(output, "." + url.pathname.slice(5));
    if (file !== output && !file.startsWith(output + path.sep)) throw new Error("Outside output");
    const target = url.pathname.endsWith("/") ? path.join(file, "index.html") : file;
    const body = await readFile(target);
    res.writeHead(200, { "Content-Type": mime[path.extname(target)] || "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}).listen(4173, "127.0.0.1");
