import { escapeHtml } from "./html.js";

/* ── Parser ──
   Mermaid flowchart subset:
     flowchart TD|LR
     ID["text"]          box
     ID(["text"])        rounded (stadium)
     A --> B             edge
     A -->|"label"| B    labeled edge
     A --> B["text"]     edge + target definition
*/

function parseNodeDef(token) {
  const idMatch = token.match(/^([A-Za-z0-9_]+)/);
  if (!idMatch) return null;
  const id = idMatch[1];
  const rest = token.slice(id.length).trim();
  if (!rest) return { id, shape: "box", label: id };

  let m = rest.match(/^\(\["([^"]*)"\]\)$/);
  if (m) return { id, shape: "round", label: m[1] };
  m = rest.match(/^\["([^"]*)"\]$/);
  if (m) return { id, shape: "box", label: m[1] };
  m = rest.match(/^\[([^\]]*)\]$/);
  if (m) return { id, shape: "box", label: m[1] };
  m = rest.match(/^\(\["?([^"\]]*)"?\]\)$/);
  if (m) return { id, shape: "round", label: m[1] };
  m = rest.match(/^\(([^)]*)\)$/);
  if (m) return { id, shape: "round", label: m[1] };

  return { id, shape: "box", label: rest };
}

function parse(source) {
  const lines = source.split("\n").map((l) => l.trim()).filter(Boolean);
  let direction = "TD";
  const nodes = new Map();
  const edges = [];
  const order = [];

  function ensureNode(id) {
    if (!nodes.has(id)) {
      nodes.set(id, { id, shape: "box", label: id });
      order.push(id);
    }
    return nodes.get(id);
  }

  function defineNode(def) {
    if (!def) return;
    if (nodes.has(def.id)) {
      const existing = nodes.get(def.id);
      if (def.label && def.label !== def.id) {
        existing.shape = def.shape;
        existing.label = def.label;
      }
    } else {
      nodes.set(def.id, def);
      order.push(def.id);
    }
  }

  for (const line of lines) {
    const dirMatch = line.match(/^flowchart\s+(TD|LR|TB|RL)\b/i);
    if (dirMatch) {
      direction = dirMatch[1].toUpperCase();
      if (direction === "TB") direction = "TD";
      if (direction === "RL") direction = "LR";
      continue;
    }
    if (/^flowchart\b/i.test(line)) continue;

    const chainMatch = line.match(/^([A-Za-z0-9_]+)\s*(\(\["[^"]*"\]\)|\["[^"]*"\]|\([^)]*\)|\[[^\]]*\])?\s*-->\s*(.+)$/);
    if (chainMatch) {
      let fromId = chainMatch[1];
      const fromShape = chainMatch[2] || "";
      let rest = chainMatch[3].trim();
      if (fromShape) defineNode(parseNodeDef(fromId + fromShape));
      else ensureNode(fromId);

      while (rest) {
        let edgeLabel = "";
        const labelMatch = rest.match(/^\|"([^"]*)"\|\s*(.+)$/);
        if (labelMatch) {
          edgeLabel = labelMatch[1];
          rest = labelMatch[2].trim();
        }
        const targetMatch = rest.match(/^([A-Za-z0-9_]+)\s*(\(\["[^"]*"\]\)|\["[^"]*"\]|\([^)]*\)|\[[^\]]*\])?\s*(?:-->\s*(.*))?$/);
        if (!targetMatch) break;
        const targetId = targetMatch[1];
        const targetShape = targetMatch[2] || "";
        const remainder = targetMatch[3] || "";
        if (targetShape) defineNode(parseNodeDef(targetId + targetShape));
        else ensureNode(targetId);
        edges.push({ from: fromId, to: targetId, label: edgeLabel });
        fromId = targetId;
        rest = remainder ? remainder.trim() : "";
      }
      continue;
    }

    const nodeMatch = line.match(/^([A-Za-z0-9_]+)\s*(.+)$/);
    if (nodeMatch) {
      const def = parseNodeDef(line);
      if (def && def.label !== def.id) {
        defineNode(def);
        continue;
      }
    }
  }

  return { direction, nodes, edges, order };
}

/* ── Layout — compute depth levels via topological sort ── */

function computeLevels(parsed) {
  const { nodes, edges, order } = parsed;
  const parents = new Map(order.map((id) => [id, []]));
  for (const e of edges) parents.get(e.to)?.push(e.from);

  const sorted = [];
  const visited = new Set();
  function visit(id) {
    if (visited.has(id)) return;
    visited.add(id);
    for (const p of parents.get(id) || []) visit(p);
    sorted.push(id);
  }
  for (const id of order) visit(id);

  const depth = new Map();
  for (const id of sorted) {
    const ps = parents.get(id) || [];
    depth.set(id, ps.length === 0 ? 0 : Math.max(...ps.map((p) => depth.get(p) || 0)) + 1);
  }

  const levels = new Map();
  let maxDepth = 0;
  for (const id of order) {
    const d = depth.get(id) || 0;
    if (!levels.has(d)) levels.set(d, []);
    levels.get(d).push(id);
    maxDepth = Math.max(maxDepth, d);
  }
  return { levels, maxDepth, depth };
}

/* ── Renderer — HTML/CSS div-based, no SVG, no text width measurement ── */

export function renderFlowchart(source) {
  try {
    const parsed = parse(source);
    if (parsed.order.length === 0) return "";

    const { levels, maxDepth } = computeLevels(parsed);
    const { nodes, edges } = parsed;

    // Build node → children map for edge rendering
    const children = new Map(parsed.order.map((id) => [id, []]));
    for (const e of edges) children.get(e.from)?.push(e.to);

    // Build edge label map
    const edgeLabels = new Map();
    for (const e of edges) {
      if (e.label) edgeLabels.set(`${e.from}→${e.to}`, e.label);
    }

    // Render each level as a flex row
    const rows = [];
    for (let d = 0; d <= maxDepth; d++) {
      const levelNodes = levels.get(d) || [];
      const nodeDivs = levelNodes.map((id) => {
        const node = nodes.get(id);
        const shapeClass = node.shape === "round" ? " fc-round" : "";
        return `<div class="fc-node${shapeClass}" data-fc-id="${escapeHtml(id)}">${escapeHtml(node.label)}</div>`;
      }).join("");
      rows.push(`<div class="fc-row">${nodeDivs}</div>`);
    }

    // Edges as CSS — connect parent bottom to child top via flex column
    // Use a simple approach: after each row, add connector divs
    // For simplicity, render edges as a separate layer using CSS ::after on nodes
    // Actually, simplest: use CSS pseudo-elements won't work for arbitrary connections.
    // Instead, render small connector divs between rows.

    // Build connector divs between levels
    const connectors = [];
    for (let d = 0; d < maxDepth; d++) {
      const currentLevel = levels.get(d) || [];
      const nextLevel = levels.get(d + 1) || [];
      const nextSet = new Set(nextLevel);

      // For each node in current level, find its children in next level
      const connectorParts = [];
      for (const id of currentLevel) {
        const kids = (children.get(id) || []).filter((c) => nextSet.has(c));
        for (const kid of kids) {
          const label = edgeLabels.get(`${id}→${kid}`);
          connectorParts.push(`<div class="fc-conn" data-from="${escapeHtml(id)}" data-to="${escapeHtml(kid)}">${label ? `<span class="fc-conn-label">${escapeHtml(label)}</span>` : '<span class="fc-conn-arrow">▼</span>'}</div>`);
        }
      }
      if (connectorParts.length) {
        connectors.push(`<div class="fc-connectors">${connectorParts.join("")}</div>`);
      }
    }

    // Interleave rows and connectors
    let html = '<div class="flowchart-diagram">';
    for (let d = 0; d <= maxDepth; d++) {
      html += rows[d] || "";
      if (d < maxDepth) html += connectors[d] || "";
    }
    html += "</div>";
    return html;
  } catch (e) {
    console.warn("flowchart render failed:", e);
    return "";
  }
}