import { test, expect } from "@playwright/test";

async function openDiagrams(page) {
  // Keep the regression independent of external fonts and KaTeX availability.
  await page.route(/^https:\/\//, route => route.abort());
  await page.goto("topics/diagrams.html");
  await expect(page.locator(".flowchart-diagram").first()).toHaveClass(/has-svg-edges/);
  await page.evaluate(() => document.fonts.ready);
}

async function inspectGeometry(page) {
  return page.locator(".flowchart-diagram").evaluateAll(roots => roots.map(root => {
    const nodes = [...root.querySelectorAll(".fc-node")].map(el => ({
      id: el.dataset.fcId, rect: el.getBoundingClientRect().toJSON(),
    }));
    const failures = [];
    for (let i = 0; i < nodes.length; i++) {
      for (const other of nodes.slice(i + 1)) {
        const a = nodes[i].rect, b = other.rect;
        if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
            Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1) {
          failures.push(`overlapping nodes ${nodes[i].id}/${other.id}`);
        }
      }
    }
    const paths = [...root.querySelectorAll(".fc-edge-line")];
    const groups = [...root.querySelectorAll(".fc-group")];
    for (const group of groups) {
      const bounds = group.getBoundingClientRect();
      for (const child of root.querySelectorAll('[data-fc-parent="' + group.dataset.fcId + '"]')) {
        const rect = child.getBoundingClientRect();
        if (rect.left < bounds.left - 1 || rect.right > bounds.right + 1 ||
            rect.top < bounds.top - 1 || rect.bottom > bounds.bottom + 1) {
          failures.push(`subgraph does not contain ${child.dataset.fcId}`);
        }
      }
    }
    for (const path of paths) {
      const matrix = path.getScreenCTM();
      const length = path.getTotalLength();
      for (let distance = 2; distance < length - 2; distance += 2) {
        const local = path.getPointAtLength(distance);
        const point = new DOMPoint(local.x, local.y).matrixTransform(matrix);
        for (const { id, rect } of nodes) {
          if (point.x > rect.left + 1 && point.x < rect.right - 1 &&
              point.y > rect.top + 1 && point.y < rect.bottom - 1) {
            failures.push(`edge passes through ${id}`);
            distance = length;
            break;
          }
        }
      }
    }
    const labels = [...root.querySelectorAll(".fc-edge-labels .fc-conn-label, .fc-group-label")];
    for (const label of labels) {
      const a = label.getBoundingClientRect();
      for (const { id, rect: b } of nodes) {
        if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
            Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1) {
          failures.push(`edge label covers ${id}`);
        }
      }
    }
    const rect = root.getBoundingClientRect();
    if (rect.left < -1 || rect.right > window.innerWidth + 1) failures.push("diagram escapes the viewport");
    return { failures, edges: paths.length, nodes: nodes.length };
  }));
}

test("workgroup fan-in preserves node text and all twelve connections", async ({ page }) => {
  await openDiagrams(page);
  const graph = page.locator(".flowchart-diagram").nth(0);
  await expect(graph.locator('[data-fc-id="B"]')).toHaveText("Workgroup (0,0,0) — 256 threads");
  const connections = await graph.locator(".fc-conn[data-from][data-to]").evaluateAll(els =>
    els.map(el => `${el.dataset.from}->${el.dataset.to}`).sort());
  expect(connections).toEqual([
    "A->B", "A->G", "A->H", "A->I", "B->C", "B->D", "B->E", "B->F",
    "B->J", "G->J", "H->J", "I->J",
  ].sort());
  await expect(graph.locator(".fc-edge-line")).toHaveCount(12);
});

test("nodes, edge routes and labels stay clear after resizing and font changes", async ({ page }) => {
  await openDiagrams(page);
  for (const { width, fontSize } of [
    { width: 1440, fontSize: 16 }, { width: 900, fontSize: 16 },
    { width: 390, fontSize: 16 }, { width: 768, fontSize: 32 },
    { width: 390, fontSize: 80 }, { width: 1440, fontSize: 16 },
  ]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(size => { document.documentElement.style.fontSize = `${size}px`; }, fontSize);
    await expect.poll(async () => (await inspectGeometry(page)).flatMap(graph => graph.failures)).toEqual([]);
    expect((await inspectGeometry(page)).map(graph => graph.edges)).toEqual([12, 5, 5, 4, 1, 2, 3, 12]);
    if (fontSize <= 32) {
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    }
  }
});

test("directions and operators in labels survive the complete site build", async ({ page }) => {
  await openDiagrams(page);
  const graphs = page.locator(".flowchart-diagram");
  for (const [index, direction, axis, sign] of [[3, "LR", "x", 1], [4, "RL", "x", -1], [5, "BT", "y", -1]]) {
    const graph = graphs.nth(index);
    const positions = await graph.locator('[data-fc-id="A"], [data-fc-id="B"]').evaluateAll(els =>
      els.map(el => el.getBoundingClientRect().toJSON()));
    expect((positions[1][axis] - positions[0][axis]) * sign, direction).toBeGreaterThan(0);
  }
  await expect(graphs.nth(5).locator('[data-fc-id="A"]')).toHaveText("<img src=x onerror=alert(1)> & --> ;");
  await expect(graphs.nth(5).locator("img")).toHaveCount(0);
});

test("printing preserves the real graph and scales the whole canvas to the page", async ({ page }) => {
  await openDiagrams(page);
  await page.emulateMedia({ media: "print" });
  await page.evaluate(() => window.dispatchEvent(new Event("beforeprint")));
  await expect.poll(async () => (await inspectGeometry(page)).flatMap(graph => graph.failures)).toEqual([]);
  const widths = await page.locator(".flowchart-diagram").evaluateAll(roots => roots.map(root => ({
    available: root.clientWidth, actual: root.querySelector(".fc-canvas").getBoundingClientRect().width,
  })));
  for (const { available, actual } of widths) expect(actual).toBeLessThanOrEqual(available + 1);
  await expect(page.locator(".fc-edges").first()).toBeVisible();
});

test("without JavaScript, every connection remains readable", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.route(/^https:\/\//, route => route.abort());
  await page.goto("http://127.0.0.1:4173/docs/topics/diagrams.html");
  const connections = page.locator(".flowchart-diagram").first().locator(".fc-conn");
  await expect(connections).toHaveCount(12);
  for (const connection of await connections.all()) await expect(connection).toBeVisible();
  await expect(connections.last()).toContainText("Workgroup (3,0,0)");
  await context.close();
});
