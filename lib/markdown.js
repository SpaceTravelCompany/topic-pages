import { marked } from "marked";
import { renderCmdstack } from "./cmdstack.js";
import { renderRelflow } from "./relflow.js";
import { renderFlowchart } from "./flowchart.js";
import { escapeHtml, slugify } from "./html.js";

function uniqueSlug(base, used) {
  let slug = base || "section";
  let i = 2;
  while (used.has(slug)) {
    slug = `${base}-${i++}`;
  }
  used.add(slug);
  return slug;
}

/* ── 콘텐츠 에셋 경로 정규화 ──
   마크다운 이미지/링크의 href를 표준 에셋(main.css 등)과 동일한 상대경로 전략으로 맞춘다.

   문제: 콘텐츠가 `/assets/x.png`처럼 사이트-루트 절대경로로 참조하면, 서브패스 배포
   (예 baseUrl=.../game-math)에서 브라우저가 도메인 루트 `/assets/x.png`로 해석해 404가 난다.
   표준 에셋은 선행 슬래시 없는 상대 `assets/...` 라 단일 index.html 기준으로 항상 해결됨.

   정책: 외부 URL(http(s):/mailto:/data: 등), 프로토콜 상대 `//`, 앵커 `#` 는 그대로 두고,
   `/` 로 시작하는 같은-배포 절대경로만 선행 슬래시를 제거해 상대경로화한다.
   단일 문서 SPA이므로 상대경로는 루트(`/`)·서브패스(`/game-math/`) 양쪽에서 안전하다.
*/
function normalizeAssetPath(href) {
  if (typeof href !== "string" || href === "") return href;
  if (/^(?:[a-zA-Z][a-zA-Z0-9+\-.]*:|\/\/|#)/.test(href)) return href;
  if (href.startsWith("/")) return href.replace(/^\/+/, "");
  return href;
}

/* ── Code-fence placeholder protection ──
   Temporarily replaces fenced code blocks so that inline directives inside
   fences (badges, callouts) are not accidentally transformed.
*/
const FENCE_PLACEHOLDER_PREFIX = "%%%CODE_FENCE_";
let fenceCounter = 0;
const fenceStore = new Map();

function protectFences(markdown) {
  fenceStore.clear();
  fenceCounter = 0;
  return markdown.replace(/(```+)\s*(\w*)\s*\n([\s\S]*?)\n\1/g, (_m, fence, lang, code) => {
    const key = `${FENCE_PLACEHOLDER_PREFIX}${fenceCounter++}%%%`;
    fenceStore.set(key, _m);
    return key;
  });
}

function restoreFences(text) {
  return text.replace(/%%%CODE_FENCE_\d+%%%/g, (key) => {
    return fenceStore.get(key) || key;
  });
}

/* ── Inline code protection ──
   Protects `code` from math regex (so $ inside `code` is not treated as math).
*/
const INLINE_CODE_PLACEHOLDER_PREFIX = "%%%INLINE_CODE_";
let inlineCodeCounter = 0;
const inlineCodeStore = new Map();

function protectInlineCode(text) {
  inlineCodeStore.clear();
  inlineCodeCounter = 0;
  return text.replace(/`([^`]+)`/g, (m) => {
    const key = `${INLINE_CODE_PLACEHOLDER_PREFIX}${inlineCodeCounter++}%%%`;
    inlineCodeStore.set(key, m);
    return key;
  });
}

function restoreInlineCode(text) {
  return text.replace(/%%%INLINE_CODE_\d+%%%/g, (key) => {
    return inlineCodeStore.get(key) || key;
  });
}

/* ── Math protection ──
   Protects $$...$$ (display) and $...$ (inline) from marked processing.
   KaTeX auto-render (client-side) will render them after page load.
   Must run after fence & inline code protection so $ inside code is skipped.
*/
const MATH_PLACEHOLDER_PREFIX = "%%%MATH_";
let mathCounter = 0;
const mathStore = new Map();

function protectMath(text) {
  mathStore.clear();
  mathCounter = 0;

  // First: $$...$$ (display math, multiline)
  text = text.replace(/\$\$([\s\S]+?)\$\$/g, (_m, content) => {
    const key = `${MATH_PLACEHOLDER_PREFIX}${mathCounter++}%%%`;
    mathStore.set(key, { raw: content.trim(), display: true });
    return key;
  });

  // Then: $...$ (inline math, single line, no $ inside)
  // Require at least one letter or backslash to avoid matching prices like "$5"
  text = text.replace(/(?<!\$)\$(?!\$)(?!\s)([^$\n]*?[a-zA-Z\\][^$\n]*?)(?<!\s)\$(?!\$)/g, (_m, content) => {
    const key = `${MATH_PLACEHOLDER_PREFIX}${mathCounter++}%%%`;
    mathStore.set(key, { raw: content, display: false });
    return key;
  });

  return text;
}

function restoreMath(html) {
  return html.replace(/%%%MATH_\d+%%%/g, (key) => {
    const entry = mathStore.get(key);
    if (!entry) return key;
    const escaped = escapeHtml(entry.raw);
    return entry.display ? `$$${escaped}$$` : `$${escaped}$`;
  });
}

/* ── Callout preprocessing ──
   Converts GFM-style callout blockquotes before marked runs.
   > [!WARNING]
   > Multi-line body...

   → <aside class="callout callout-warn" role="note">...</aside>
*/
const CALLOUT_MAP = {
  note:      { cls: "note",      label: "참고" },
  tip:       { cls: "tip",       label: "팁" },
  important: { cls: "important", label: "중요" },
  warning:   { cls: "warn",      label: "주의" },
  caution:   { cls: "danger",    label: "위험" },
  danger:    { cls: "danger",    label: "위험" },
  info:      { cls: "info",      label: "정보" },
  success:   { cls: "success",   label: "성공" },
};

function preprocessCallouts(markdown) {
  const lines = markdown.split("\n");
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const m = line.match(/^> \[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION|DANGER|INFO|SUCCESS)\]\s*$/);
    if (m) {
      const type = m[1].toLowerCase();
      const mapping = CALLOUT_MAP[type] || CALLOUT_MAP.note;
      i++;
      const bodyLines = [];
      while (i < lines.length) {
        const bl = lines[i];
        if (bl.startsWith("> ")) {
          bodyLines.push(bl.slice(2));
          i++;
        } else if (bl === ">") {
          bodyLines.push("");
          i++;
        } else {
          break;
        }
      }
      const body = bodyLines.join("\n").trim();
      // P1-3: Render inline markdown inside callout body instead of raw text
      // marked.parseInline only processes inline markup (bold, code, links)
      // and does not wrap in <p> tags — safe for callout body content.
      const inlineHtml = marked.parseInline(body, { mangle: false });
      out.push(`<aside class="callout callout-${mapping.cls}" role="note">`);
      out.push(`  <span class="callout-label">${mapping.label}</span>`);
      out.push(`  <div class="callout-body">${inlineHtml}</div>`);
      out.push(`</aside>`);
    } else {
      out.push(line);
      i++;
    }
  }
  return out.join("\n");
}

/* ── Inline badge preprocessing ──
   [!badge-warn:DEPRECATED]  →  <span class="badge badge-warn">DEPRECATED</span>
   [!badge-danger:EXPERIMENTAL]  →  <span class="badge badge-danger">실험적</span>
*/
function preprocessBadges(text) {
  return text.replace(/\[!badge-(\w+):([^\]]+)\]/g, (_m, type, content) => {
    return `<span class="badge badge-${type}">${escapeHtml(content)}</span>`;
  });
}

export function renderMarkdown(markdown) {
  const headings = [];
  const usedIds = new Set();
  const renderer = new marked.Renderer();
  const defaultTable = renderer.table.bind(renderer);

  // Preprocess: protect fences → protect inline code → callouts/badges → math → restore inline code → restore fences
  // Order matters: fences first so directives inside code blocks are not transformed.
  // Inline code protected before math so $ inside `code` is not treated as math.
  let protected_ = protectFences(markdown);
  protected_ = protectInlineCode(protected_);
  protected_ = preprocessCallouts(protected_);
  protected_ = preprocessBadges(protected_);
  protected_ = protectMath(protected_);
  protected_ = restoreInlineCode(protected_);
  const processed = restoreFences(protected_);

  renderer.heading = ({ tokens, depth }) => {
    const text = tokens.map((token) => token.raw ?? token.text ?? "").join("");
    const id = uniqueSlug(slugify(text), usedIds);

    if (depth <= 4) {
      headings.push({ id, text, depth });
    }

    return `<h${depth} id="${id}">${escapeHtml(text)}</h${depth}>`;
  };

  // 이미지 src 를 표준 에셋과 동일한 상대경로 전략으로 정규화.
  // 절대경로 `/assets/..` 를 그대로 두면 서브패스 배포 시 도메인 루트로 빠져 404 가 되므로,
  // marked 기본 렌더를 덮어쓰지 않고 href 만 normalizeAssetPath 로 가공한다.
  renderer.image = (token) => {
    const href = normalizeAssetPath(token.href);
    const alt = escapeHtml(token.text ?? "");
    const title = token.title ? ` title="${escapeHtml(token.title)}"` : "";
    return `<img src="${escapeHtml(href ?? "")}" alt="${alt}"${title}>`;
  };

  renderer.table = (token) => {
    return `<div class="prose-table-wrap">${defaultTable(token)}</div>`;
  };

  renderer.code = (token) => {
    if (token.lang === "cmdstack" || token.lang === "diagram") {
      return renderCmdstack(token.text);
    }
    if (token.lang === "relflow") {
      return renderRelflow(token.text);
    }
    if (token.lang === "flowchart") {
      return renderFlowchart(token.text);
    }

    const lang = token.lang || "text";
    const escaped = escapeHtml(token.text);
    return `<div class="code-toolbar" data-lang="${lang}">
  <span class="code-lang">${lang}</span>
  <button type="button" class="copy-code-btn" aria-label="코드 복사">📋</button>
  <pre class="language-${lang}"><code class="language-${lang}">${escaped}</code></pre>
  <span class="copy-toast" role="status" aria-live="polite"></span>
</div>`;
  };

  const html = restoreMath(marked(processed, { renderer }));
  return { html, headings };
}
