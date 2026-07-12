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

  // Preprocess: protect fences, then callouts/badges, then restore fences
  // Order matters: fences first so directives inside code blocks are not transformed.
  let protected_ = protectFences(markdown);
  protected_ = preprocessCallouts(protected_);
  protected_ = preprocessBadges(protected_);
  const processed = restoreFences(protected_);

  renderer.heading = ({ tokens, depth }) => {
    const text = tokens.map((token) => token.raw ?? token.text ?? "").join("");
    const id = uniqueSlug(slugify(text), usedIds);

    if (depth <= 4) {
      headings.push({ id, text, depth });
    }

    return `<h${depth} id="${id}">${escapeHtml(text)}</h${depth}>`;
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

  const html = marked(processed, { renderer });
  return { html, headings };
}
