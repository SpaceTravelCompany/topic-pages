import { escapeHtml } from "./html.js";

/* Mermaid subset: boxes, rounded nodes, labeled arrows, chains, & and subgraphs.
   Tokenize shapes and quoted labels before operators: -->, & and ; inside a
   node's text must never become graph syntax. Layout belongs to the browser,
   where actual font and node dimensions are available. */
const quoted = '"(?:\\\\.|[^"\\\\])*"';
const nodeToken = new RegExp(`^([A-Za-z0-9_]+)(?:[ \\t]*(\\(\\[${quoted}\\]\\)|\\[${quoted}\\]|\\[[^\\]\\n]*\\]|\\([^\\)\\n]*\\)))?`);
const edgeLabelToken = new RegExp(`^\\|(${quoted}|[^|\\n]*)\\|`);

function decodeLabel(label) {
  if (label.startsWith('"') && label.endsWith('"')) label = label.slice(1, -1);
  return label.replace(/\\([n"\\])/g, (_, char) => char === "n" ? "\n" : char);
}

function parseNodeDef(match) {
  const id = match[1];
  const shape = match[2] || "";
  const stadium = shape.startsWith("([");
  const label = shape ? shape.slice(stadium ? 2 : 1, stadium ? -2 : -1) : id;
  return { id, shape: shape.startsWith("(") ? "round" : "box", label: decodeLabel(label), defined: !!shape };
}

function tokenize(source) {
  const statements = [];
  let tokens = [];
  let direction = "TB";
  let rest = source.replace(/\r\n?/g, "\n");
  while (rest) {
    const whitespace = rest.match(/^[^\S\n]+|^%%[^\n]*/);
    if (whitespace) { rest = rest.slice(whitespace[0].length); continue; }
    if (/^[\n;]/.test(rest)) {
      if (tokens.length) statements.push(tokens);
      tokens = [];
      rest = rest.slice(1);
      continue;
    }
    const header = !tokens.length && rest.match(/^(?:flowchart|graph)\s+(TD|TB|BT|LR|RL)\b/i);
    if (header) {
      direction = header[1].toUpperCase().replace("TD", "TB");
      rest = rest.slice(header[0].length);
      continue;
    }
    const operator = rest.match(/^(-->|&)/);
    const label = rest.match(edgeLabelToken);
    const node = rest.match(nodeToken);
    if (operator) tokens.push({ kind: operator[0] });
    else if (label) tokens.push({ kind: "label", label: decodeLabel(label[1]) });
    else if (node) tokens.push({ kind: "node", node: parseNodeDef(node) });
    else throw new SyntaxError(`Unsupported flowchart syntax: ${rest.slice(0, 40)}`);
    rest = rest.slice((operator || label || node)[0].length);
  }
  if (tokens.length) statements.push(tokens);
  return { statements, direction };
}

function parse(source) {
  const { statements, direction } = tokenize(source);
  const nodes = new Map();
  const edges = new Map();
  const groups = new Map();
  const groupStack = [];
  for (const tokens of statements) {
    if (tokens[0].node?.id === "subgraph" && tokens.length === 2 && tokens[1].kind === "node") {
      const group = tokens[1].node;
      if (groups.has(group.id) || nodes.has(group.id)) throw new SyntaxError("Duplicate subgraph id");
      groups.set(group.id, { ...group, parent: groupStack.at(-1) });
      groupStack.push(group.id);
      continue;
    }
    if (tokens.length === 1 && tokens[0].node?.id === "end") {
      if (!groupStack.length) throw new SyntaxError("Unexpected subgraph end");
      groupStack.pop();
      continue;
    }
    let index = 0;
    function readGroup() {
      const group = [];
      do {
        const token = tokens[index++];
        if (token?.kind !== "node") throw new SyntaxError("Expected a flowchart node");
        const node = token.node;
        if (groups.has(node.id)) throw new SyntaxError("Arrows to subgraphs are unsupported");
        if (node.defined || !nodes.has(node.id)) {
          nodes.set(node.id, { ...node, parent: groupStack.at(-1) || nodes.get(node.id)?.parent });
        }
        group.push(node.id);
        if (tokens[index]?.kind !== "&") break;
        index++;
      } while (index <= tokens.length);
      return group;
    }
    let from = readGroup();
    while (index < tokens.length) {
      if (tokens[index++].kind !== "-->") throw new SyntaxError("Expected a flowchart arrow");
      const label = tokens[index]?.kind === "label" ? tokens[index++].label : "";
      const to = readGroup();
      for (const a of from) {
        for (const b of to) edges.set(JSON.stringify([a, b, label]), { from: a, to: b, label });
      }
      from = to;
    }
  }
  if (groupStack.length) throw new SyntaxError("Unclosed subgraph");
  return { direction, nodes, groups, edges: [...edges.values()] };
}

export function renderFlowchart(source) {
  try {
    const { direction, nodes, groups, edges } = parse(source);
    if (!nodes.size) return "";
    const nodeHtml = [...nodes.values()].map(node =>
      `<div class="fc-node${node.shape === "round" ? " fc-round" : ""}" data-fc-id="${escapeHtml(node.id)}"${node.parent ? ` data-fc-parent="${escapeHtml(node.parent)}"` : ""}>${escapeHtml(node.label)}</div>`).join("");
    const groupHtml = [...groups.values()].map(group =>
      `<div class="fc-group" data-fc-id="${escapeHtml(group.id)}"${group.parent ? ` data-fc-parent="${escapeHtml(group.parent)}"` : ""}><span class="fc-group-label">${escapeHtml(group.label)}</span></div>`).join("");
    // This complete edge list is also the readable no-JS / assistive fallback.
    // No edge is discarded because it skips a level or points back to a node.
    const connections = edges.map(edge =>
      `<li class="fc-conn" data-from="${escapeHtml(edge.from)}" data-to="${escapeHtml(edge.to)}"><span>${escapeHtml(nodes.get(edge.from).label)} → ${escapeHtml(nodes.get(edge.to).label)}</span>${edge.label ? `<span class="fc-conn-label">${escapeHtml(edge.label)}</span>` : ""}</li>`).join("");
    return `<div class="flowchart-diagram" data-fc-direction="${direction}"><div class="fc-canvas">${groupHtml}${nodeHtml}</div><ol class="fc-connectors" aria-label="Connections">${connections}</ol></div>`;
  } catch (error) {
    console.warn("flowchart render failed:", error);
    return `<pre class="flowchart-source"><code>${escapeHtml(source)}</code></pre>`;
  }
}
