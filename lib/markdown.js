import { marked } from "marked";
import { renderCmdstack } from "./cmdstack.js";
import { renderRelflow } from "./relflow.js";
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
      const escapedBody = escapeHtml(body);
      out.push(`<aside class="callout callout-${mapping.cls}" role="note">`);
      out.push(`  <span class="callout-label">${mapping.label}</span>`);
      out.push(`  <div class="callout-body">${escapedBody}</div>`);
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

  // Preprocess callouts and badges before marked runs
  let processed = preprocessCallouts(markdown);
  processed = preprocessBadges(processed);

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
