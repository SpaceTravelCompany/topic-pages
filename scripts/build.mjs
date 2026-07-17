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
 *                     custom.css/custom.js 가 이 디렉토리(또는 빌더 기본 assets)에
 *                     존재하면 index.html 에서 로드됨.
 *
 * site.json 스키마:
 *   {
 *     "title": "사이트 이름",
 *     "subtitle": "부제목",
 *     "brandMark": "Tp",                       // nav 좌측 마크 (선택, 기본: title 앞 2글자)
 *     "brandMarkSvg": "<svg ...>...</svg>",    // 인라인 SVG 브랜드 마크 (선택, brandMark보다 우선, XSS 필터 통과 시만 적용)
 *     "storagePrefix": "my-ref",               // localStorage 네임스페이스 (선택, 기본: "topic-pages")
 *     "theme": {                                // CSS 변수 주입 (선택). light/dark 분리.
 *       "light": {                               // html[data-theme="light"] 에 주입 (선택)
 *         "brand": "#7c3aed",                    // → --brand
 *         "primary": "#1a1a1a",                  // → --primary
 *         "primaryFg": "#fafafa",                 // → --primary-fg (카멜케이스 → --primary-fg)
 *         "accent": "#7c3aed",                    // → --accent. 정적 색으로 덮어쓰기.
 *                                                 //   --accent-dim/glow 도 color-mix 로 재계산 (light: 90%/75%)
 *         "link": "#0969da"                       // → --link
 *       },
 *       "dark": {                                // html[data-theme="dark"] 에 주입 (선택)
 *         "brand": "#a371f7",                     // → --brand
 *         "primary": "#e5e5e5",                   // → --primary
 *         "primaryFg": "#1a1a1a",                 // → --primary-fg
 *         "accent": "#a371f7",                     // → --accent. --accent-dim/glow 재계산 (dark: 85%/65%)
 *         "link": "#79c0ff"                        // → --link
 *       }
 *     },
 *     // theme 전체, light, dark 각각 선택. 각 키도 선택 — 생략 시 main.css 기본값 사용.
 *     // 값은 CSS 색 문자열만 허용: #hex, rgb()/oklch()/oklab()/hsl() 함수, var(--x), named color.
 *     // 그 외 문자열은 warn 후 무시 (XSS 방지).
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
    baseUrl: "",
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--site") args.site = path.resolve(argv[++i]);
    else if (a === "--content") args.content = path.resolve(argv[++i]);
    else if (a === "--out") args.out = path.resolve(argv[++i]);
    else if (a === "--assets") args.assets = path.resolve(argv[++i]);
    else if (a === "--base-url") args.baseUrl = argv[++i];
    else if (a === "--help" || a === "-h") {
      console.log(`Usage: node scripts/build.mjs [--site <path>] [--content <path>] [--out <path>] [--assets <path>] [--base-url <url>]`);
      process.exit(0);
    }
  }
  return args;
}

function assetPath(p) { return p; }
function linkToSlug(slug) { return `#${slug}`; }

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
      const groupId = section.id || slugify(section.title, { maxLength: 40 });
      return `<div class="nav-group" data-group-id="${escapeHtml(groupId)}">
  <p class="nav-group-label">${escapeHtml(section.title)}</p>
  <div class="nav-group-btns">${buttons}</div>
</div>`;
    })
    .join("");

  const referencesHtml = renderReferences(site.references);

  const title = site.title || "Site";
  const brandSvg = validateSvg(site.brandMarkSvg, "site.json");
  const brandMarkInner = brandSvg
    ? `${brandSvg}`  // 인라인 SVG — validateSvg 통과한 안전한 마크업
    : escapeHtml((site.brandMark || title).slice(0, 2));  // 폴백: 텍스트

  return `<nav class="nav-panel" id="nav" aria-label="주제">
  <div class="nav-brand">
    <div class="brand-btn">
      <span class="brand-mark">${brandMarkInner}</span>
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

// site.json theme 키 → CSS 변수명 매핑.
// brand/primary/primaryFg/accent/link 지원. 각 키 선택적.
const THEME_KEY_MAP = {
  brand: "--brand",
  primary: "--primary",
  primaryFg: "--primary-fg",
  accent: "--accent",
  link: "--link",
};

// CSS 색 값으로 허용하는 패턴. XSS 방지 — 색이 아닌 문자열 거부.
//  #7c3aed / 7c3aed       — hex (3,4,6,8 자리)
//  oklch(...) / oklab(...) — CSS 색 함수
//  rgb(...) / rgba(...)    — CSS 색 함수
//  var(--name)             — CSS 변수 참조
//  named color (red, blue) — 기본 CSS 색 키워드
const COLOR_RE = /^(#[0-9a-fA-F]{3,8}|oklab\([^;{}]*\)|oklch\([^;{}]*\)|rgba?\([^;{}]*\)|hsla?\([^;{}]*\)|var\(--[a-zA-Z0-9-]+\)|[a-zA-Z]+)$/;

function validateColor(value, key, scope) {
  if (typeof value !== "string" || !COLOR_RE.test(value.trim())) {
    console.warn(`  warn: theme.${scope}.${key} 값이 CSS 색으로 보이지 않아 무시합니다: ${JSON.stringify(value)}`);
    return null;
  }
  return value.trim();
}

// SVG 브랜드 마크 검증 — XSS 방지.
// 통과 조건:
//   1. 문자열이 <svg>로 시작하고 </svg>로 끝남 (앞뒤 공백 허용)
//   2. 위험 토큰 없음: <script, onload, onerror, onclick, on*, javascript:, <iframe, <foreignObject, expression(
//   3. 허용된 자식 요소만: path, circle, rect, g, polyline, polygon, line, ellipse, defs, use, symbol, linearGradient, radialGradient, stop, svg
//   4. style 속성 허용하지만 style 값 내 javascript:/expression() 차단
// 통과 시 원본 반환, 실패 시 null + warn.
const SVG_ALLOWED_TAGS = new Set([
  "svg", "path", "circle", "rect", "g", "polyline", "polygon", "line",
  "ellipse", "defs", "use", "symbol", "linearGradient", "radialGradient", "stop",
]);
const SVG_DANGER_RE = /<script|<iframe|<foreignObject|\bon\w+\s*=|javascript:|expression\s*\(/i;

function validateSvg(svg, source) {
  if (typeof svg !== "string" || svg.trim() === "") return null;

  const trimmed = svg.trim();
  if (!/^<svg[\s>]/i.test(trimmed) || !/<\/svg>\s*$/i.test(trimmed)) {
    console.warn(`  warn: ${source} brandMarkSvg가 <svg>...</svg> 형식이 아님 — 무시하고 brandMark(텍스트)로 폴백합니다.`);
    return null;
  }

  // 위험 토큰 일괄 차단 (on*, javascript:, script, iframe, foreignObject, expression)
  if (SVG_DANGER_RE.test(trimmed)) {
    console.warn(`  warn: ${source} brandMarkSvg에 위험 토큰(script/on*/javascript:/iframe/foreignObject/expression) 감지 — 무시하고 brandMark(텍스트)로 폴백합니다.`);
    return null;
  }

  // 모든 태그 이름 추출 → 허용 목록 검증
  const tagMatches = trimmed.matchAll(/<([a-zA-Z][\w-]*)/g);
  for (const m of tagMatches) {
    const tag = m[1].toLowerCase();
    if (!SVG_ALLOWED_TAGS.has(tag)) {
      console.warn(`  warn: ${source} brandMarkSvg에 허용되지 않은 태그 <${tag}> 감지 — 무시하고 brandMark(텍스트)로 폴백합니다.`);
      return null;
    }
  }

  return trimmed;
}

// theme 객체에서 CSS 변수 선언 문자열 생성.
// accent가 주어지면 --accent-dim/--accent-glow도 color-mix로 재계산.
// dimPct/glowPct: main.css의 light(90%/75%)와 dark(85%/65%) 비율 참조.
function renderScopeDecls(scopeMap, dimPct, glowPct) {
  const decls = [];
  for (const [jsonKey, cssVar] of Object.entries(THEME_KEY_MAP)) {
    const v = scopeMap[jsonKey];
    if (v == null || v === "") continue;
    const safe = validateColor(v, jsonKey, scopeMap._scope);
    if (!safe) continue;
    decls.push(`  ${cssVar}: ${safe};`);
    if (jsonKey === "accent") {
      decls.push(`  --accent-dim: color-mix(in srgb, ${safe}, transparent ${dimPct}%);`);
      decls.push(`  --accent-glow: color-mix(in srgb, ${safe}, transparent ${glowPct}%);`);
    }
  }
  return decls;
}

// site.theme를 <style> 블록으로 렌더. null/빈이면 빈 문자열.
// light/dark 분리 — 각각 main.css 대응 selector에 매칭:
//   light: html[data-theme="light"] (명시도 0,1,1 — main.css :root 0,0,1보다 높아 무조건 승)
//   dark:  html[data-theme="dark"]  (main.css와 동일 0,1,1 → 소스 순서로 승, 주입이 뒤에 옴)
// accent 파생 비율: light 90%/75%, dark 85%/65% (main.css 참조).
function renderThemeStyle(theme) {
  if (!theme || (typeof theme !== "object")) return "";
  const light = theme.light || {};
  const dark = theme.dark || {};
  light._scope = "light";
  dark._scope = "dark";

  const lightDecls = renderScopeDecls(light, 90, 75);
  const darkDecls = renderScopeDecls(dark, 85, 65);

  if (lightDecls.length === 0 && darkDecls.length === 0) return "";

  const blocks = [];
  if (lightDecls.length) {
    blocks.push(`html[data-theme="light"] {\n${lightDecls.join("\n")}\n}`);
  }
  if (darkDecls.length) {
    blocks.push(`html[data-theme="dark"] {\n${darkDecls.join("\n")}\n}`);
  }
  if (blocks.length === 0) return "";

  return `  <style data-theme-override>
${blocks.join("\n\n")}
  </style>`;
}

function pageShell(opts) {
  const { site, title, description, canonicalUrl, bodyHtml, siteDataJson, searchIndexJson } = opts;
  const storagePrefix = escapeHtml(site?.storagePrefix || "topic-pages");
  const nav = renderNav(site);
  const asset = assetPath;
  const themeStyle = renderThemeStyle(site?.theme);

  // custom.css/custom.js — 빌드 시 존재 검사 후 조건부 로드 (copyAssets과 동일 소스 우선순위).
  // main.css/prism.css 뒤(custom.css), app.js 뒤(custom.js)에 위치해 우선순위/의존성 확보.
  const customCssLink = opts.hasCustomCss
    ? `\n  <link rel="stylesheet" href="${asset("assets/custom.css")}">`
    : "";
  const customJsScript = opts.hasCustomJs
    ? `\n  <script src="${asset("assets/custom.js")}"></script>`
    : "";

  const canonicalTag = canonicalUrl
    ? `  <link rel="canonical" href="${canonicalUrl}">\n  <meta property="og:url" content="${canonicalUrl}">`
    : "";
  const ogMeta = description
    ? `  <meta property="og:title" content="${escapeHtml(title)}">\n  <meta property="og:description" content="${escapeHtml(description)}">\n  <meta property="og:type" content="website">`
    : "";
  const descMeta = description ? `  <meta name="description" content="${escapeHtml(description)}">` : "";

  return `<!DOCTYPE html>
<html lang="ko" data-theme="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
${descMeta}
${canonicalTag}
${ogMeta}
  <link rel="icon" type="image/svg+xml" href="${asset("assets/favicon.svg")}">
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
  <link rel="stylesheet" href="${asset("assets/main.css")}">
${themeStyle}
  <link rel="stylesheet" href="${asset("assets/prism.css")}">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.22/dist/katex.min.css" crossorigin="anonymous">${customCssLink}
</head>
<body>
  <a class="skip-link" href="#main">본문으로 건너뛰기</a>
  <a class="skip-link" href="#nav">주제 메뉴로 건너뛰기</a>
  <div class="app" id="app">
    <div class="nav-backdrop" id="nav-backdrop" hidden></div>
    <div class="toc-backdrop" id="toc-backdrop" hidden></div>
    ${nav}
    <main class="main-panel" id="main" tabindex="-1">
      <header class="main-header">
        <button type="button" class="icon-btn nav-toggle" id="nav-toggle" aria-label="주제 메뉴">☰</button>
        <div class="main-header-text">
          <p class="main-eyebrow" id="topic-eyebrow">${escapeHtml(site?.title || "")}</p>
        </div>
        <div class="main-header-actions">
          <button type="button" class="icon-btn search-trigger" id="search-trigger" aria-label="검색 열기 (Ctrl+K)">🔍</button>
          <button type="button" class="icon-btn reader-toggle" id="reader-toggle" aria-label="글자 크기 토글">A</button>
          <button type="button" class="icon-btn theme-toggle" id="theme-toggle" aria-label="테마 전환">
            <svg class="theme-icon-dark" aria-hidden="true" viewBox="0 0 24 24" fill="currentColor">
              <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>
            </svg>
            <svg class="theme-icon-light" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="4"/>
              <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>
            </svg>
          </button>
          <button type="button" class="toc-toggle" id="toc-toggle" aria-label="목차 토글" aria-controls="toc-panel" aria-expanded="false">☰ 목차</button>

        </div>
      </header>
      ${bodyHtml}
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
  <script type="application/json" id="site-data">${siteDataJson}</script>
  <script src="${asset("assets/prism.js")}"></script>
  <script src="https://cdn.jsdelivr.net/npm/katex@0.16.22/dist/katex.min.js" crossorigin="anonymous"></script>
  <script src="https://cdn.jsdelivr.net/npm/katex@0.16.22/dist/contrib/auto-render.min.js" crossorigin="anonymous"></script>
  <script>
    document.addEventListener("DOMContentLoaded", function() {
      if (window.renderMathInElement) {
        function renderMath() {
          renderMathInElement(document.getElementById("content-viewport") || document.body, {
            delimiters: [
              {left: "$$", right: "$$", display: true},
              {left: "$", right: "$", display: false}
            ],
            throwOnError: false
          });
        }
        renderMath();
        // Re-render when topic changes (SPA navigation)
        const observer = new MutationObserver(function() { renderMath(); });
        const vp = document.getElementById("content-viewport");
        if (vp) observer.observe(vp, {childList: true, subtree: true, characterData: true});
      }
    });
  </script>
  <script src="${asset("assets/app.js")}"></script>${customJsScript}
</body>
</html>`;
}

function renderSinglePage(siteData, searchIndex, customAssets) {
  const site = siteData.site;
  const topics = siteData.topics;
  const sections = site.sections || [];
  const baseUrl = site.baseUrl || "";

  // Landing cards — hash links to topics
  const sectionGroupsHtml = sections
    .map((section) => {
      const cards = (section.topics || [])
        .map((topic) => {
          const meta = topics[topic.slug];
          const summary = topic.summary || meta?.summary || "";
          return `    <a class="topic-card" href="${linkToSlug(topic.slug)}">
      <p class="topic-card-group">${escapeHtml(section.title)}</p>
      <h3 class="topic-card-title">${topic.icon ? escapeHtml(topic.icon) + " " : ""}${escapeHtml(topic.title)}</h3>
      ${summary ? `<p class="topic-card-summary">${escapeHtml(summary)}</p>` : ""}
    </a>`;
        })
        .join("\n");

      return `  <section class="landing-section">
    <h2 class="landing-section-title">${escapeHtml(section.title)}</h2>
    <div class="landing-grid">
${cards}
    </div>
  </section>`;
    })
    .join("\n");

  const landingHtml = `    <article class="content-viewport prose" id="content-viewport-landing" role="tabpanel">
  <p class="landing-subtitle">${escapeHtml(site.subtitle || "")}</p>
${sectionGroupsHtml}
    </article>`;

  // All topics' sections in one viewport, prefixed ids to avoid collisions
  const allSectionsHtml = Object.entries(topics)
    .flatMap(([slug, topic]) =>
      topic.sections.map((section, idx) => {
        const sectionId = `${slug}-${section.id}`;
        return `      <section class="topic-section" data-topic="${escapeHtml(slug)}" data-section-idx="${idx}" id="${escapeHtml(sectionId)}">
        <h2 class="topic-section-title">${escapeHtml(section.title)}</h2>
        ${section.html}
      </section>`;
      }),
    )
    .join("\n");

  const topicHtml = `    <article class="content-viewport prose" id="content-viewport" role="tabpanel">
${allSectionsHtml}
    </article>`;

  const bodyHtml = `  <div class="view-landing" id="view-landing">
${landingHtml}
  </div>
  <div class="view-topic" id="view-topic" hidden>
${topicHtml}
  </div>`;

  const siteDataForJson = JSON.stringify({ site, topics }).replace(/</g, "\\u003c");
  const searchIndexJson = searchIndex
    ? `<script type="application/json" id="search-index">${JSON.stringify(searchIndex).replace(/</g, "\\u003c")}</script>\n`
    : "";

  const canonicalUrl = baseUrl ? `${baseUrl}/` : "";

  return pageShell({
    site,
    title: site.title || "Site",
    description: site.subtitle || "",
    canonicalUrl,
    bodyHtml,
    siteDataJson: siteDataForJson,
    searchIndexJson,
    hasCustomCss: customAssets?.hasCustomCss ?? false,
    hasCustomJs: customAssets?.hasCustomJs ?? false,
  });
}

// custom.css/custom.js 존재 여부 검사 — copyAssets과 동일한 순서(사용자 assets 우선, 빌더 기본 assets 폴백).
// pageShell이 <link>/<script> 태그를 조건부로 추가하는 근거.
async function hasAsset(args, file) {
  const userSrc = path.join(args.assets, file);
  const builderAssets = path.resolve(__dirname, "..", "assets");
  const fallbackSrc = path.join(builderAssets, file);
  try { await fs.access(userSrc); return true; } catch {}
  try { await fs.access(fallbackSrc); return true; } catch {}
  return false;
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
  if (args.baseUrl) console.log(`  baseUrl: ${args.baseUrl}`);

  await fs.rm(args.out, { recursive: true, force: true });
  await fs.mkdir(args.out, { recursive: true });

  const siteData = await buildSiteData(args);
  // Merge baseUrl from CLI arg > site.json > ""
  siteData.site.baseUrl = args.baseUrl || siteData.site.baseUrl || "";

  const searchIndex = buildSearchIndex(siteData);
  console.log(`  search index: ${searchIndex.records.length} records`);

  // custom.css/custom.js 존재 검사 — copyAssets과 동일 소스 우선순위.
  const hasCustomCss = await hasAsset(args, "custom.css");
  const hasCustomJs = await hasAsset(args, "custom.js");
  if (hasCustomCss) console.log("  custom.css: loaded");
  if (hasCustomJs) console.log("  custom.js: loaded");

  // Single index.html (landing + all topics)
  const page = renderSinglePage(siteData, searchIndex, { hasCustomCss, hasCustomJs });
  await fs.writeFile(path.join(args.out, "index.html"), page, "utf-8");
  console.log("  index.html");

  await copyAssets(args);
  console.log(`\nBuild complete → ${args.out}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
