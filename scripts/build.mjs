import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderMarkdown } from "../lib/markdown.js";
import { splitMarkdownByH2 } from "../lib/sections.js";
import { escapeHtml, slugify } from "../lib/html.js";
import { buildSearchIndex } from "../lib/search-index.js";

/**
 * 범용 정적 사이트 빌더.
 *
 * 사용법:
 *   node scripts/build.mjs [옵션]
 *
 * 옵션:
 *   --site   <path>   site.json 경로 (기본: ./site.json)
 *   --content <path>  콘텐츠 디렉토리 (기본: ./content)
 *   --out    <path>   출력 디렉토리 (기본: ./dist)
 *   --assets <path>   빌드에 포함할 에셋 디렉토리 (기본: ./assets)
 *
 * site.json 스키마:
 *   {
 *     "title": "사이트 이름",
 *     "subtitle": "부제목",
 *     "brandMark": "Tp",                       // nav 좌측 마크 (선택, 기본: title 앞 2글자)
 *     "storagePrefix": "my-ref",               // localStorage 네임스페이스 (선택, 기본: "topic-pages")
 *     "theme": {                                // CSS 변수 주입 (선택)
 *       "primary": "#7c3aed",                  // 브랜드 메인 색
 *       "primaryFg": "#ffffff",                // primary 위 글자색
 *       "accent": "#f59e0b",                   // 강조 색
 *       "link": "#7c3aed"                      // 본문 링크 색
 *     },
 *     "references": [
 *       { "label": "링크 이름", "href": "https://..." }
 *     ],
 *     "sections": [
 *       {
 *         "id": "섹션 그룹 id",
 *         "title": "섹션 그룹 이름",
 *         "topics": [
 *           { "slug": "content/<slug>.md와 매칭", "title": "...", "summary": "...", "icon": "기호" }
 *         ]
 *       }
 *     ]
 *   }
 *
 * content/<slug>.md 파일:
 *   ---
 *   title: 주제 이름
 *   slug: 동일 slug
 *   ---
 *
 *   ## 섹션1
 *   본문...
 *
 *   ## 섹션2
 *   본문...
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

function parseArgs(argv) {
  // CLI 인자가 없으면 현재 작업 디렉토리(CWD) 기준.
  // 인자가 있으면 그 경로를 그대로 사용 (절대/상관 없음).
  const cwd = process.cwd();
  const args = {
    site: path.join(cwd, "site.json"),
    content: path.join(cwd, "content"),
    out: path.join(cwd, "dist"),
    assets: path.join(cwd, "assets"),
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--site") args.site = path.resolve(argv[++i]);
    else if (a === "--content") args.content = path.resolve(argv[++i]);
    else if (a === "--out") args.out = path.resolve(argv[++i]);
    else if (a === "--assets") args.assets = path.resolve(argv[++i]);
    else if (a === "--help" || a === "-h") {
      console.log(`Usage: node scripts/build.mjs [--site <path>] [--content <path>] [--out <path>] [--assets <path>]`);
      process.exit(0);
    }
  }
  return args;
}

function parseFrontmatter(raw) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return { meta: {}, body: raw };

  const meta = {};
  for (const line of match[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx > 0) meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return { meta, body: match[2] };
}

function buildTopicSections(body) {
  const chunks = splitMarkdownByH2(body.trim());
  const usedIds = new Set();

  return chunks.map((chunk) => {
    const { html, headings } = renderMarkdown(chunk.lines.join("\n").trim());
    const baseId = slugify(chunk.title, { maxLength: 80 });
    let id = baseId;
    let n = 2;
    while (usedIds.has(id)) {
      id = `${baseId}-${n++}`;
    }
    usedIds.add(id);
    // Prepend section title as a virtual h2 heading for TOC reference
    const sectionHeading = { id, text: chunk.title, depth: 2 };
    return { id, title: chunk.title, html, headings: [sectionHeading, ...headings] };
  });
}

function renderReferences(references) {
  if (!Array.isArray(references) || references.length === 0) return "";

  const links = references
    .map((ref) => {
      const label = escapeHtml(ref.label || "");
      const href = escapeHtml(ref.href || "#");
      return `    <a class="reference-link" href="${href}" target="_blank" rel="noopener noreferrer">
      <span class="reference-link-mark" aria-hidden="true">↗</span>
      <span class="reference-link-label">${label}</span>
    </a>`;
    })
    .join("\n");

  return `  <div class="nav-reference" aria-label="외부 참고 레퍼런스">
    <p class="nav-group-label">외부 참고 레퍼런스</p>
    <div class="reference-links">
${links}
    </div>
  </div>`;
}

function renderNav(site) {
  const groups = (site.sections || [])
    .map((section) => {
      const buttons = (section.topics || [])
        .map((topic) => {
          return `<button type="button" class="topic-btn" data-topic="${topic.slug}" title="${escapeHtml(topic.summary || "")}">
  <span class="topic-btn-icon" aria-hidden="true">${topic.icon || ""}</span>
  <span class="topic-btn-label">${escapeHtml(topic.title)}</span>
</button>`;
        })
        .join("");
      return `<div class="nav-group">
  <p class="nav-group-label">${escapeHtml(section.title)}</p>
  <div class="nav-group-btns">${buttons}</div>
</div>`;
    })
    .join("");

  const referencesHtml = renderReferences(site.references);

  const title = site.title || "Site";
  const brand = (site.brandMark || title).slice(0, 2);

  return `<nav class="nav-panel" id="nav" aria-label="주제">
  <div class="nav-brand">
    <div class="brand-btn">
      <span class="brand-mark">${escapeHtml(brand)}</span>
      <span class="brand-text">${escapeHtml(title)}</span>
    </div>
    <p class="brand-sub">${escapeHtml(site.subtitle || "")}</p>
  </div>
  ${groups}
${referencesHtml}
  <div class="nav-license" aria-label="라이선스">
    <a class="cc-badge" href="https://creativecommons.org/licenses/by-nc-sa/4.0/" target="_blank" rel="license noopener noreferrer" title="문서/콘텐츠: CC BY-NC-SA 4.0">
      <img class="cc-badge-img" src="assets/cc-by-nc-sa.svg" alt="CC BY-NC-SA 4.0">
    </a>
  </div>
</nav>`;
}

async function buildSiteData(args) {
  const site = JSON.parse(await fs.readFile(args.site, "utf-8"));
  if (!site.storagePrefix) site.storagePrefix = "topic-pages";

  const slugs = [...new Set(site.sections.flatMap((s) => (s.topics || []).map((t) => t.slug)))];
  const topicMetaBySlug = new Map(
    site.sections.flatMap((section) => (section.topics || []).map((topic) => [topic.slug, topic])),
  );

  const topics = {};

  for (const slug of slugs) {
    const filePath = path.join(args.content, `${slug}.md`);
    const raw = await fs.readFile(filePath, "utf-8");
    const { meta, body } = parseFrontmatter(raw);
    const metaTopic = topicMetaBySlug.get(slug);

    topics[slug] = {
      title: meta.title || slug,
      summary: metaTopic?.summary || "",
      sections: buildTopicSections(body),
    };
    console.log(`  ${slug}: ${topics[slug].sections.length} sections`);
  }

  return { site, topics };
}

function renderPage(siteData, searchIndex) {
  const json = JSON.stringify(siteData).replace(/</g, "\\u003c");
  const nav = renderNav(siteData.site);
  const title = siteData.site?.title || "Site";
  const storagePrefix = escapeHtml(siteData.site?.storagePrefix || "topic-pages");
  const searchIndexJson = searchIndex
    ? `<script type="application/json" id="search-index">${JSON.stringify(searchIndex).replace(/</g, "\\u003c")}</script>\n`
    : "";

  return `<!DOCTYPE html>
<html lang="ko" data-theme="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <link rel="icon" type="image/svg+xml" href="assets/favicon.svg">
  <script>
    (function () {
      var key = "${storagePrefix}-theme";
      var saved = localStorage.getItem(key);
      var theme = saved;
      if (!theme) {
        theme = window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
      }
      document.documentElement.dataset.theme = theme;
    })();
  </script>
  <link rel="stylesheet" href="assets/main.css">
  <link rel="stylesheet" href="assets/prism.css">
</head>
<body>
  <a class="skip-link" href="#main">본문으로 건너뛰기</a>
  <a class="skip-link" href="#nav">주제 메뉴로 건너뛰기</a>
  <div class="app" id="app">
    <div class="nav-backdrop" id="nav-backdrop" hidden></div>
    ${nav}
    <main class="main-panel" id="main" tabindex="-1">
      <header class="main-header">
        <button type="button" class="icon-btn nav-toggle" id="nav-toggle" aria-label="주제 메뉴">☰</button>
        <div class="main-header-text">
          <p class="main-eyebrow" id="topic-eyebrow">${escapeHtml(title)}</p>
          <h1 class="main-title" id="section-title"></h1>
        </div>
        <div class="main-header-actions">
          <button type="button" class="icon-btn search-trigger" id="search-trigger" aria-label="검색 열기 (Ctrl+K)">🔍</button>
          <button type="button" class="icon-btn theme-toggle" id="theme-toggle" aria-label="테마 전환">
            <span class="theme-icon-dark" aria-hidden="true">☾</span>
            <span class="theme-icon-light" aria-hidden="true">☀</span>
          </button>
          <button type="button" class="toc-toggle" id="toc-toggle" aria-label="목차 토글" aria-controls="toc-panel" aria-expanded="false">☰ 목차</button>
          <button type="button" class="icon-btn sec-nav-btn" id="sec-prev" disabled aria-label="이전 섹션">‹</button>
          <span class="sec-counter" id="sec-counter"></span>
          <button type="button" class="icon-btn sec-nav-btn" id="sec-next" disabled aria-label="다음 섹션">›</button>
        </div>
      </header>
      <article class="content-viewport prose" id="content-viewport" role="tabpanel"></article>
    </main>
    <aside class="toc-panel" id="toc-panel" aria-label="이 페이지 목차"></aside>
  </div>
  ${searchIndexJson}
  <div class="search-backdrop" id="search-backdrop" hidden></div>
  <div class="search-modal" id="search-modal" role="dialog" aria-modal="true" aria-labelledby="search-input-label" hidden>
    <label class="visually-hidden" id="search-input-label">검색</label>
    <input type="search" class="search-input" id="search-input" placeholder="검색 (Ctrl+K)" autocomplete="off" spellcheck="false" />
    <ul class="search-results" id="search-results" role="listbox" aria-label="검색 결과"></ul>
    <div class="search-footer">
      <span><kbd>↑</kbd><kbd>↓</kbd> 이동</span>
      <span><kbd>Enter</kbd> 선택</span>
      <span><kbd>Esc</kbd> 닫기</span>
    </div>
  </div>
  <script type="application/json" id="site-data">${json}</script>
  <script src="assets/prism.js"></script>
  <script src="assets/app.js"></script>
</body>
</html>`;
}

async function copyAssets(args) {
  const dest = path.join(args.out, "assets");
  await fs.mkdir(dest, { recursive: true });

  const required = ["main.css", "prism.css", "prism.js", "app.js", "favicon.svg", "cc-by-nc-sa.svg"];
  const optional = ["custom.css", "custom.js"];

  // 빌더 자신의 assets 디렉토리 (폴백용)
  const builderAssets = path.resolve(__dirname, "..", "assets");

  for (const file of [...required, ...optional]) {
    const userSrc = path.join(args.assets, file);
    const fallbackSrc = path.join(builderAssets, file);
    let chosen = null;
    let source = "user";
    try {
      await fs.access(userSrc);
      chosen = userSrc;
    } catch {
      try {
        await fs.access(fallbackSrc);
        chosen = fallbackSrc;
        source = "builder";
      } catch {
        // both missing
      }
    }

    if (chosen) {
      await fs.copyFile(chosen, path.join(dest, file));
    } else if (required.includes(file)) {
      console.warn(`  warn: required asset not found in user or builder: ${file}`);
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(`Build options:`);
  console.log(`  site:    ${args.site}`);
  console.log(`  content: ${args.content}`);
  console.log(`  out:     ${args.out}`);
  console.log(`  assets:  ${args.assets}`);

  await fs.rm(args.out, { recursive: true, force: true });
  await fs.mkdir(args.out, { recursive: true });

  const siteData = await buildSiteData(args);
  const searchIndex = buildSearchIndex(siteData);
  console.log(`  search index: ${searchIndex.records.length} records`);
  const page = renderPage(siteData, searchIndex);
  await fs.writeFile(path.join(args.out, "index.html"), page, "utf-8");
  console.log("  index.html (SPA)");

  await copyAssets(args);
  console.log(`\nBuild complete → ${args.out}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
