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
 *     "subtitle": "부제목 (선택, 없으면 랜딩 제목 아래에 렌더하지 않음)",
 *     "brandMark": "Tp",                       // 헤더 좌측 마크 (선택, 기본: title 앞 2글자)
 *     "brandMarkSvg": "<svg ...>...</svg>",    // 인라인 SVG 브랜드 마크 (선택, brandMark보다 우선, XSS 필터 통과 시만 적용)
 *     "storagePrefix": "my-ref",               // localStorage 네임스페이스 (선택, 기본: "topic-pages")
 *     "bodyFont": "mono",                      // 본문 폰트 (선택): "mono"(기본, DM Mono + Nanum Gothic Coding) | "sans"(IBM Plex Sans KR)
 *     "theme": {                                // CSS 변수 주입 (선택). 라이트 모드 전용.
 *       "accent": "#63C8C1",                     // → --accent. 브랜드 마크·활성 항목·칩·강조 배경. 기본 #63C8C1.
 *                                                 //   --accent-dark/--accent-soft 는 CSS 가 color-mix 로 파생,
 *                                                 //   --accent-fg(accent 위 글자색)는 hex 일 때 명암 대비로 자동 선택.
 *       "link": "#005CC5"                        // → --link. 본문 링크색 (선택)
 *     },
 *     // 레거시 호환: theme.light.accent / theme.light.brand → accent, theme.light.link → link.
 *     // theme.dark 는 무시한다(다크 모드 제거됨 — warn 출력).
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

function makeAssetFn(baseUrl, isTopic) {
  if (baseUrl) return (p) => baseUrl.replace(/\/+$/, "") + "/" + p;
  return isTopic ? (p) => "../" + p : (p) => p;
}

function makeLinkFn(baseUrl, isTopic) {
  if (baseUrl) return (slug) => baseUrl.replace(/\/+$/, "") + "/topics/" + slug + ".html";
  return isTopic ? (slug) => "../topics/" + slug + ".html" : (slug) => "topics/" + slug + ".html";
}

function makeLandingHref(baseUrl, isTopic) {
  if (baseUrl) return baseUrl.replace(/\/+$/, "") + "/";
  return isTopic ? "../index.html" : "./index.html";
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

// 랜딩·토픽 공통 푸터: 참고 자료 링크(선택) + 빌더 크레딧.
function renderFooter(site) {
  const refs = Array.isArray(site.references) ? site.references : [];
  const refsHtml = refs.length
    ? `
    <span class="site-footer-label">참고 자료 →</span>` +
      refs
        .map((ref) => {
          const label = escapeHtml(ref.label || "");
          const href = escapeHtml(ref.href || "#");
          return `
    <a class="site-footer-link" href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`;
        })
        .join("")
    : "";
  return `<footer class="site-footer">
  <div class="site-footer-inner">${refsHtml}
    <span class="site-footer-credit">Built with topic-pages</span>
  </div>
</footer>`;
}

// 아이콘은 시안처럼 흑백 글리프로 보이게 U+FE0E(text presentation)를 붙인다 — 🔍 ⌛ 같은 이모지가 컬러로 뜨는 것 방지.
function renderIcon(icon) {
  return icon ? escapeHtml(icon) + "︎" : "";
}

const ICON_SEARCH =
  '<svg class="icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="M20 20l-3.5-3.5"></path></svg>';
const ICON_MENU =
  '<svg class="icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"></path></svg>';
const ICON_CLOSE =
  '<svg class="icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"></path></svg>';
const ICON_ARROW_UP_RIGHT =
  '<svg class="icon topic-card-arrow" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17L17 7M9 7h8v8"></path></svg>';
const ICON_CHEVRON_RIGHT =
  '<svg class="icon topic-card-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"></path></svg>';
const ICON_CHEVRON_DOWN =
  '<svg class="icon nav-group-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"></path></svg>';

// 사이드바(토픽 페이지 ≥52em) 겸 드로어(좁은 폭 · 랜딩 전 폭). 브랜드는 헤더로 올라갔다.
function renderNav(site, linkFn, activeTopicSlug) {
  const groups = (site.sections || [])
    .map((section) => {
      const groupId = section.id || slugify(section.title, { maxLength: 40 });
      const bodyId = `nav-group-${escapeHtml(groupId)}`;
      const buttons = (section.topics || [])
        .map((topic) => {
          const isActive = topic.slug === activeTopicSlug;
          return `<a href="${linkFn(topic.slug)}" class="topic-btn${isActive ? " active" : ""}" data-topic="${topic.slug}"${isActive ? ' aria-current="page"' : ""} title="${escapeHtml(topic.summary || "")}">
  <span class="topic-btn-icon" aria-hidden="true">${renderIcon(topic.icon)}</span>
  <span class="topic-btn-label">${escapeHtml(topic.title)}</span>
</a>`;
        })
        .join("");
      return `<div class="nav-group" data-group-id="${escapeHtml(groupId)}">
  <button type="button" class="nav-group-label" aria-expanded="true" aria-controls="${bodyId}"><span class="nav-group-title">${escapeHtml(section.title)}</span>${ICON_CHEVRON_DOWN}</button>
  <div class="nav-group-btns" id="${bodyId}">${buttons}</div>
</div>`;
    })
    .join("");

  return `<nav class="nav-panel" id="nav" aria-label="주제">
  <div class="nav-drawer-head">
    <span class="nav-drawer-title">주제</span>
    <button type="button" class="icon-btn nav-close" id="nav-close" aria-label="메뉴 닫기">${ICON_CLOSE}</button>
  </div>
  <div class="nav-filter">
    <label class="nav-filter-label" for="nav-filter-input">주제 필터</label>
    <input type="search" class="nav-filter-input" id="nav-filter-input" placeholder="키워드로 거르기" autocomplete="off" spellcheck="false">
  </div>
  ${groups}
  <p class="nav-filter-empty" id="nav-filter-empty" role="status" hidden>일치하는 주제가 없어요</p>
</nav>`;
}

function renderBrand(site, landingHref) {
  const title = site.title || "Site";
  const brandSvg = validateSvg(site.brandMarkSvg, "site.json");
  const brandMarkInner = brandSvg
    ? brandSvg // 인라인 SVG — validateSvg 통과한 안전한 마크업
    : escapeHtml((site.brandMark || title).slice(0, 2)); // 폴백: 텍스트
  return `<a class="brand-btn" href="${landingHref}">
        <span class="brand-mark">${brandMarkInner}</span>
        <span class="brand-text">${escapeHtml(title)}</span>
      </a>`;
}

function renderSiteHeader(site, landingHref, pageType) {
  const tocToggle =
    pageType === "topic"
      ? `
      <button type="button" class="toc-toggle" id="toc-toggle" aria-label="목차 열기" aria-controls="toc-panel" aria-expanded="false">목차 열기</button>`
      : "";
  return `<header class="site-header">
    <div class="site-header-inner">
      ${renderBrand(site, landingHref)}
      <div class="site-header-actions">
        <button type="button" class="search-trigger" id="search-trigger" aria-label="검색 열기 (Ctrl+K)">
          ${ICON_SEARCH}<span class="search-trigger-label">주제 · 본문 검색</span><kbd class="search-trigger-kbd">Ctrl K</kbd>
        </button>${tocToggle}
        <button type="button" class="icon-btn nav-toggle" id="nav-toggle" aria-label="주제 메뉴 열기" aria-controls="nav" aria-expanded="false">${ICON_MENU}</button>
      </div>
    </div>
  </header>`;
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

// CSS 색 값으로 허용하는 패턴. XSS 방지 — 색이 아닌 문자열 거부.
//  #7c3aed / 7c3aed       — hex (3,4,6,8 자리)
//  oklch(...) / oklab(...) — CSS 색 함수
//  rgb(...) / rgba(...)    — CSS 색 함수
//  var(--name)             — CSS 변수 참조
//  named color (red, blue) — 기본 CSS 색 키워드
const COLOR_RE = /^(#[0-9a-fA-F]{3,8}|oklab\([^;{}]*\)|oklch\([^;{}]*\)|rgba?\([^;{}]*\)|hsla?\([^;{}]*\)|var\(--[a-zA-Z0-9-]+\)|[a-zA-Z]+)$/;

function validateColor(value, key) {
  if (typeof value !== "string" || !COLOR_RE.test(value.trim())) {
    console.warn(`  warn: theme.${key} 값이 CSS 색으로 보이지 않아 무시합니다: ${JSON.stringify(value)}`);
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

// hex(#rgb/#rrggbb) 색 위에 올릴 글자색(#000/#fff)을 WCAG 상대 휘도로 고른다.
// hex 가 아니면(rgb()/oklch()/var() 등) null — CSS 기본 --accent-fg(#000)를 그대로 쓴다.
function readableTextOn(color) {
  const m = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(color);
  if (!m) return null;
  const hex = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
  const lin = [0, 2, 4].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
  // 흰 글자 대비 (1.05 / (L + 0.05)) 가 검정 글자 대비 ((L + 0.05) / 0.05) 보다 크면 흰색.
  return 1.05 / (luminance + 0.05) > (luminance + 0.05) / 0.05 ? "#fff" : "#000";
}

// site.theme 를 :root 변수 <style> 블록으로 렌더. 라이트 전용.
// 신규: theme.accent / theme.link. 레거시: theme.light.{accent,brand,link} 도 읽는다. theme.dark 는 무시(warn).
// --accent-dark/--accent-soft 는 main.css 가 --accent 로부터 파생하므로 여기서 만들지 않는다.
function renderThemeStyle(theme) {
  if (!theme || typeof theme !== "object") return "";
  if (theme.dark) console.warn("  warn: theme.dark 는 무시됩니다 — 라이트 모드만 지원합니다.");

  const legacy = theme.light && typeof theme.light === "object" ? theme.light : {};
  const pick = (value, key) => (value == null || value === "" ? null : validateColor(value, key));
  const accent = pick(theme.accent ?? legacy.accent ?? legacy.brand, "accent");
  const link = pick(theme.link ?? legacy.link, "link");

  const decls = [];
  if (accent) {
    decls.push(`  --accent: ${accent};`);
    const fg = readableTextOn(accent);
    if (fg) decls.push(`  --accent-fg: ${fg};`);
  }
  if (link) decls.push(`  --link: ${link};`);
  if (decls.length === 0) return "";

  return `  <style data-theme-override>
:root {
${decls.join("\n")}
}
  </style>`;
}

const GOOGLE_FONTS_BASE =
  "https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Mono:wght@400;500&family=Do+Hyeon&family=Nanum+Gothic+Coding:wght@400;700";
const GOOGLE_FONTS_SANS = "&family=IBM+Plex+Sans+KR:wght@400;600";

function bodyFontOf(site) {
  return site?.bodyFont === "sans" ? "sans" : "mono";
}

function pageShell(opts) {
  const {
    site, title, description, canonicalUrl, bodyHtml,
    pageType, activeTopicSlug, asset, linkToTopic,
    topicDataJson, hasCustomCss, hasCustomJs, themeStyle,
  } = opts;
  const storagePrefix = escapeHtml(site?.storagePrefix || "topic-pages");
  const landingHref = makeLandingHref(site?.baseUrl || "", pageType === "topic");
  const nav = renderNav(site, linkToTopic, activeTopicSlug);
  const siteHeader = renderSiteHeader(site, landingHref, pageType);
  const siteFooter = renderFooter(site);
  const tocPanel = pageType === "topic"
    ? `
    <aside class="toc-panel" id="toc-panel" aria-label="이 페이지 목차">
      <div class="toc-head">
        <span class="toc-title">이 페이지</span>
        <button type="button" class="icon-btn toc-close" id="toc-close" aria-label="목차 닫기">${ICON_CLOSE}</button>
      </div>
      <div class="toc-list" data-toc-list></div>
      <button type="button" class="toc-top" data-toc-top>↑ 맨 위로</button>
    </aside>`
    : "";
  const tocBackdrop = pageType === "topic"
    ? `
    <div class="toc-backdrop" id="toc-backdrop" hidden></div>`
    : "";
  const bodyFont = bodyFontOf(site);
  const fontsHref = GOOGLE_FONTS_BASE + (bodyFont === "sans" ? GOOGLE_FONTS_SANS : "") + "&display=swap";

  const customCssLink = hasCustomCss
    ? `\n  <link rel="stylesheet" href="${asset("assets/custom.css")}">`
    : "";
  const customJsScript = hasCustomJs
    ? `\n  <script src="${asset("assets/custom.js")}"></script>`
    : "";

  const canonicalTag = canonicalUrl
    ? `  <link rel="canonical" href="${canonicalUrl}">\n  <meta property="og:url" content="${canonicalUrl}">`
    : "";
  const ogMeta = description
    ? `  <meta property="og:title" content="${escapeHtml(title)}">\n  <meta property="og:description" content="${escapeHtml(description)}">\n  <meta property="og:type" content="website">`
    : "";
  const descMeta = description ? `  <meta name="description" content="${escapeHtml(description)}">` : "";

  const topicDataScript = topicDataJson
    ? `<script type="application/json" id="topic-data">${topicDataJson}</script>\n`
    : "";

  const baseUrlVal = site?.baseUrl || "";
  const searchIndexUrl = baseUrlVal
    ? baseUrlVal.replace(/\/+$/, "") + "/search-index.json"
    : pageType === "topic" ? "../search-index.json" : "search-index.json";
  const bodyDataAttrs = `data-page-type="${pageType}" data-body-font="${bodyFont}"` +
    (activeTopicSlug ? ` data-topic-slug="${escapeHtml(activeTopicSlug)}"` : "") +
    (baseUrlVal ? ` data-base-url="${escapeHtml(baseUrlVal)}"` : "") +
    ` data-storage-prefix="${storagePrefix}"` +
    ` data-search-index-url="${escapeHtml(searchIndexUrl)}"`;

  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light">
  <title>${escapeHtml(title)}</title>
${descMeta}
${canonicalTag}
${ogMeta}
  <link rel="icon" type="image/svg+xml" href="${asset("assets/favicon.svg")}">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="${fontsHref}">
  <link rel="stylesheet" href="${asset("assets/main.css")}">
${themeStyle}
  <link rel="stylesheet" href="${asset("assets/prism.css")}">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.22/dist/katex.min.css" crossorigin="anonymous">${customCssLink}
</head>
<body ${bodyDataAttrs}>
  <a class="skip-link" href="#main">본문으로 건너뛰기</a>
  <a class="skip-link" href="#nav">주제 메뉴로 건너뛰기</a>
  ${siteHeader}
  <div class="layout layout-${pageType}" id="app">
    <div class="nav-backdrop" id="nav-backdrop" hidden></div>${tocBackdrop}
    ${nav}
    <main class="main-panel" id="main" tabindex="-1">
      ${bodyHtml}
    </main>${tocPanel}
  </div>
  ${siteFooter}
${topicDataScript}  <div class="search-backdrop" id="search-backdrop" hidden></div>
  <div class="search-modal" id="search-modal" role="dialog" aria-modal="true" aria-labelledby="search-input-label" hidden>
    <div class="search-header">
      <label class="visually-hidden" id="search-input-label">검색</label>
      <input type="search" class="search-input" id="search-input" placeholder="검색 (Ctrl+K)" autocomplete="off" spellcheck="false" />
      <button type="button" class="search-close-btn" id="search-close-btn" aria-label="검색 닫기">✕</button>
    </div>
    <ul class="search-results" id="search-results" role="listbox" aria-label="검색 결과"></ul>
    <div class="search-footer">
      <span><kbd>↑</kbd><kbd>↓</kbd> 이동</span>
      <span><kbd>Enter</kbd> 선택</span>
      <span><kbd>Esc</kbd> 닫기</span>
    </div>
  </div>
  <script src="${asset("assets/prism.js")}"></script>
  <script src="https://cdn.jsdelivr.net/npm/katex@0.16.22/dist/katex.min.js" crossorigin="anonymous" defer></script>
  <script src="https://cdn.jsdelivr.net/npm/katex@0.16.22/dist/contrib/auto-render.min.js" crossorigin="anonymous" defer></script>
  <script>
    document.addEventListener("DOMContentLoaded", function() {
      if (window.renderMathInElement) {
        var mathTimer = null;
        function renderMath() {
          if (mathTimer) clearTimeout(mathTimer);
          mathTimer = setTimeout(function() {
            mathTimer = null;
            (window.requestIdleCallback || function(cb) { setTimeout(cb, 0); })(function() {
              renderMathInElement(document.getElementById("content-viewport") || document.body, {
                delimiters: [
                  {left: "$$", right: "$$", display: true},
                  {left: "$", right: "$", display: false}
                ],
                throwOnError: false
              });
            });
          }, 150);
        }
        renderMath();
        const observer = new MutationObserver(function() { renderMath(); });
        const vp = document.getElementById("content-viewport");
        if (vp) observer.observe(vp, {childList: true});
      }
    });
  </script>
  <script src="${asset("assets/app.js")}"></script>${customJsScript}
</body>
</html>`;
}

function renderLandingPage(siteData, searchIndex, customAssets) {
  const site = siteData.site;
  const topics = siteData.topics;
  const sections = site.sections || [];
  const baseUrl = site.baseUrl || "";

  const asset = makeAssetFn(baseUrl, false);
  const linkToTopic = makeLinkFn(baseUrl, false);

  const topicCount = sections.reduce((n, section) => n + (section.topics || []).length, 0);

  const sectionGroupsHtml = sections
    .map((section, idx) => {
      const topicList = section.topics || [];
      const cards = topicList
        .map((topic) => {
          const meta = topics[topic.slug];
          const summary = topic.summary || meta?.summary || "";
          return `        <a class="topic-card" href="${linkToTopic(topic.slug)}">
          <span class="topic-card-icon" aria-hidden="true">${renderIcon(topic.icon)}</span>
          ${ICON_ARROW_UP_RIGHT}${ICON_CHEVRON_RIGHT}
          <span class="topic-card-text">
            <span class="topic-card-title">${escapeHtml(topic.title)}</span>${summary ? `
            <span class="topic-card-summary">${escapeHtml(summary)}</span>` : ""}
          </span>
        </a>`;
        })
        .join("\n");

      const no = String(idx + 1).padStart(2, "0");
      return `      <section class="landing-section" aria-label="${escapeHtml(section.title)}">
        <div class="landing-section-meta">
          <span class="landing-section-no">${no}</span>
          <h2 class="landing-section-title">${escapeHtml(section.title)}</h2>
          <span class="landing-section-count">${topicList.length}개 주제</span>
        </div>
        <div class="landing-grid">
${cards}
        </div>
      </section>`;
    })
    .join("\n");

  const landingSubtitleHtml = site.subtitle
    ? `
          <p class="landing-subtitle">${escapeHtml(site.subtitle)}</p>`
    : "";

  const landingHtml = `    <article class="landing" id="content-viewport-landing">
      <div class="landing-head">
        <div class="landing-head-text">
          <h1 class="landing-title">전체 주제</h1>${landingSubtitleHtml}
        </div>
        <span class="landing-stats">${sections.length}개 섹션 · ${topicCount}개 주제</span>
      </div>
${sectionGroupsHtml}
    </article>`;

  const bodyHtml = `  <div class="view-landing" id="view-landing">
${landingHtml}
  </div>`;

  const canonicalUrl = baseUrl ? `${baseUrl}/` : "";

  return pageShell({
    site,
    title: site.title || "Site",
    description: site.subtitle || "",
    canonicalUrl,
    bodyHtml,
    pageType: "landing",
    activeTopicSlug: "",
    asset,
    linkToTopic,
    topicDataJson: null,
    themeStyle: siteData.themeStyle,
    hasCustomCss: customAssets?.hasCustomCss ?? false,
    hasCustomJs: customAssets?.hasCustomJs ?? false,
  });
}

// "동기화 (Synchronization)" → ["동기화", "Synchronization"]. 끝이 괄호로 닫힌 제목만 둘로 나눈다.
function splitTitle(title) {
  const m = /^(.+?)\s*\((.+)\)\s*$/.exec(String(title).trim());
  return m ? [m[1].trim(), m[2].trim()] : [String(title).trim()];
}

// site.sections 를 펼친 순서대로 이전/다음 주제와 소속 그룹을 구한다. 같은 slug 가 여러 번 나오면 첫 항목 기준.
function locateTopic(site, slug) {
  const flat = [];
  for (const section of site.sections || []) {
    for (const topic of section.topics || []) flat.push({ topic, group: section.title || "" });
  }
  const idx = flat.findIndex((entry) => entry.topic.slug === slug);
  if (idx < 0) return { group: "", prev: null, next: null };
  return {
    group: flat[idx].group,
    prev: idx > 0 ? flat[idx - 1].topic : null,
    next: idx < flat.length - 1 ? flat[idx + 1].topic : null,
  };
}

function renderPager(prev, next, linkToTopic) {
  if (!prev && !next) return "";
  const card = (topic, cls, label) => `
      <a class="pager-card ${cls}" href="${linkToTopic(topic.slug)}" rel="${cls === "pager-prev" ? "prev" : "next"}">
        <span class="pager-label">${label}</span>
        <span class="pager-title">${escapeHtml(topic.title)}</span>
      </a>`;
  return `
    <nav class="pager" aria-label="이전·다음 주제">${prev ? card(prev, "pager-prev", "← 이전") : ""}${next ? card(next, "pager-next", "다음 →") : ""}
    </nav>`;
}

function renderTopicPage(siteData, slug, topic, customAssets) {
  const site = siteData.site;
  const baseUrl = site.baseUrl || "";

  const asset = makeAssetFn(baseUrl, true);
  const linkToTopic = makeLinkFn(baseUrl, true);

  // Single topic's sections, prefixed ids for anchor compatibility
  const sectionsHtml = topic.sections
    .map((section, idx) => {
      const sectionId = `${slug}-${section.id}`;
      return `      <section class="topic-section" data-topic="${escapeHtml(slug)}" data-section-idx="${idx}" id="${escapeHtml(sectionId)}">
        <h2 class="topic-section-title">${escapeHtml(section.title)}</h2>
        ${section.html}
      </section>`;
    })
    .join("\n");

  const { group, prev, next } = locateTopic(site, slug);
  const titleLines = splitTitle(topic.title).map(escapeHtml);
  const breadcrumbHtml = group
    ? `<p class="breadcrumb">${escapeHtml(group)} / ${escapeHtml(topic.title)}</p>`
    : `<p class="breadcrumb">${escapeHtml(topic.title)}</p>`;
  const summaryHtml = topic.summary
    ? `\n        <p class="article-summary">${escapeHtml(topic.summary)}</p>`
    : "";

  const topicHtml = `    <article class="topic-article">
      <header class="article-head">
        ${breadcrumbHtml}
        <h1 class="article-title">${titleLines.join("<br>")}</h1>${summaryHtml}
      </header>
      <details class="toc-inline" id="toc-inline">
        <summary>이 페이지 목차</summary>
        <div class="toc-list" data-toc-list></div>
      </details>
      <div class="content-viewport prose" id="content-viewport">
${sectionsHtml}
      </div>${renderPager(prev, next, linkToTopic)}
    </article>`;

  const bodyHtml = `  <div class="view-topic" id="view-topic">
${topicHtml}
  </div>`;

  // Topic metadata for TOC initialization (sections: id/title/headings)
  const topicData = {
    slug,
    title: topic.title,
    sections: topic.sections.map((s) => ({
      id: s.id,
      title: s.title,
      headings: s.headings || [],
    })),
  };
  const topicDataJson = JSON.stringify(topicData).replace(/</g, "\\u003c");

  const canonicalUrl = baseUrl ? `${baseUrl}/topics/${slug}.html` : "";

  return pageShell({
    site,
    title: `${topic.title} — ${site.title}`,
    description: topic.summary || site.subtitle || "",
    canonicalUrl,
    bodyHtml,
    pageType: "topic",
    activeTopicSlug: slug,
    asset,
    linkToTopic,
    topicDataJson,
    themeStyle: siteData.themeStyle,
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

  const required = ["main.css", "prism.css", "prism.js", "app.js", "favicon.svg"];
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

  // 사용자 assets 디렉터리의 나머지 파일(필수/선택 목록에 없는 것)도 dist/assets/로 복사.
  // 마크다운 콘텐츠에서 참조하는 임의의 이미지(PNG, JPG 등)가 dist에 포함되도록.
  // 빌더 자신의 assets는 폴백 전용이므로 여기선 복사하지 않음.
  const pinned = new Set([...required, ...optional]);
  try {
    const entries = await fs.readdir(args.assets, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (pinned.has(entry.name)) continue;
      const src = path.join(args.assets, entry.name);
      await fs.copyFile(src, path.join(dest, entry.name));
    }
  } catch {
    // args.assets 디렉터리가 존재하지 않으면 조용히 건너뜀
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
  await fs.mkdir(path.join(args.out, "topics"), { recursive: true });

  const siteData = await buildSiteData(args);
  // Merge baseUrl from CLI arg > site.json > ""
  siteData.site.baseUrl = args.baseUrl || siteData.site.baseUrl || "";
  siteData.themeStyle = renderThemeStyle(siteData.site.theme);

  const searchIndex = buildSearchIndex(siteData);
  console.log(`  search index: ${searchIndex.records.length} records`);

  // custom.css/custom.js 존재 검사 — copyAssets과 동일 소스 우선순위.
  const hasCustomCss = await hasAsset(args, "custom.css");
  const hasCustomJs = await hasAsset(args, "custom.js");
  if (hasCustomCss) console.log("  custom.css: loaded");
  if (hasCustomJs) console.log("  custom.js: loaded");

  const customAssets = { hasCustomCss, hasCustomJs };

  // Landing page
  const landingPage = renderLandingPage(siteData, searchIndex, customAssets);
  await fs.writeFile(path.join(args.out, "index.html"), landingPage, "utf-8");
  console.log("  index.html (landing)");

  // Topic pages (parallel)
  const topicEntries = Object.entries(siteData.topics);
  await Promise.all(
    topicEntries.map(async ([slug, topic]) => {
      const topicPage = renderTopicPage(siteData, slug, topic, customAssets);
      await fs.writeFile(path.join(args.out, "topics", `${slug}.html`), topicPage, "utf-8");
      console.log(`  topics/${slug}.html`);
    }),
  );
  console.log(`  topics: ${topicEntries.length} pages`);

  // Search index as standalone JSON file
  await fs.writeFile(
    path.join(args.out, "search-index.json"),
    JSON.stringify(searchIndex),
    "utf-8",
  );
  console.log("  search-index.json");

  await copyAssets(args);
  console.log(`\nBuild complete → ${args.out}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
