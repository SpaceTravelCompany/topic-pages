import { test, expect } from "@playwright/test";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";

test("a new build replaces cached styles and scripts without a hard refresh", async ({ page }) => {
  const directory = await mkdtemp(path.join(tmpdir(), "topic-pages-cache-"));
  const assets = path.join(directory, "assets");
  const output = path.join(directory, "site");
  await mkdir(assets);
  const css = await readFile("assets/main.css", "utf8");
  const requests = [];
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      const file = path.join(output, url.pathname);
      const body = await readFile(file);
      const extension = path.extname(file);
      const isAsset = url.pathname.startsWith("/assets/");
      if (isAsset) requests.push(req.url);
      res.writeHead(200, {
        "Content-Type": { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml" }[extension] || "application/octet-stream",
        "Cache-Control": isAsset ? "public, max-age=31536000, immutable" : "no-store",
        // Request routing disables Playwright's HTTP cache. Block unrelated
        // third-party fonts/scripts with CSP so this test exercises real caching.
        "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'",
      });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const build = () => execFileSync(process.execPath, ["scripts/build.mjs",
    "--site", "tests/fixtures/site.json", "--content", "tests/fixtures/content",
    "--assets", assets, "--out", output, "--base-url", origin,
  ], { stdio: "pipe" });

  try {
    // Seed the browser's real HTTP cache with the old static-node layout.
    await writeFile(path.join(assets, "main.css"), css + "\n.fc-node { position: static !important; }");
    await writeFile(path.join(assets, "custom.js"), 'document.querySelector("h1").textContent = "First release";');
    build();
    await page.goto(`${origin}/topics/diagrams.html?release=1`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("First release");
    await expect(page.locator(".fc-node").first()).toHaveCSS("position", "static");
    const firstRequests = requests.splice(0);

    await writeFile(path.join(assets, "main.css"), css);
    await writeFile(path.join(assets, "custom.js"), 'document.querySelector("h1").textContent = "Updated release";');
    build();
    await page.goto(`${origin}/topics/diagrams.html?release=2`);
    await expect(page.locator(".fc-node").first()).toHaveCSS("position", "absolute");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Updated release");
    await expect(page.locator(".flowchart-diagram").first().locator(".fc-edge-line")).toHaveCount(12);
    // Unchanged assets should still benefit from the browser cache.
    expect(firstRequests.some(url => url.includes("prism.js"))).toBe(true);
    expect(requests.some(url => url.includes("prism.js"))).toBe(false);
  } finally {
    await page.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
