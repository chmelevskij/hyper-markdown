import type { DiagramPart } from "../types";

/**
 * Addressing individual parts of a rendered Mermaid diagram.
 *
 * Mermaid v11 stamps semantic markers onto its SVG output — `data-et` /
 * `data-id` on edges, participants, messages and life lines, and ids like
 * `<render-id>-flowchart-A-0` on flowchart nodes. Those survive a re-render
 * (theme flip, live reload, remount) once the per-render id prefix is stripped,
 * which is what lets a comment stay attached to "node A" rather than to a
 * position on screen.
 */

/** mermaid's `data-et` ("element type") vocabulary → our kind names. */
const KIND_BY_ET: Record<string, string> = {
  edge: "edge",
  participant: "participant",
  "life-line": "lifeline",
  message: "message",
  note: "note",
};

/** Kinds drawn as strokes: highlighted by recolouring, not by tinting a box. */
export const LINE_KINDS = new Set(["edge", "message", "lifeline"]);

/** Elements a click can address, most specific first. */
const PART_SELECTOR = [
  "[data-et]",
  "g.node",
  "g.cluster",
  "g.edgeLabel",
  "g.actor",
  "g.note",
  "g.section",
  "text.messageText",
  "text.actor",
  "rect.task",
  "text.taskText",
  "path.relation",
  "path.transition",
].join(",");

/** Line-ish geometry, used for the "click near an edge" proximity fallback. */
const LINE_SELECTOR = [
  "path.flowchart-link",
  '[data-et="edge"]',
  '[data-et="message"]',
  '[data-et="life-line"]',
  'line[class*="messageLine"]',
  "path.relation",
  "path.transition",
].join(",");

/** Layout groups that are never a meaningful comment target. */
const STRUCTURAL = new Set([
  "root",
  "nodes",
  "edgePaths",
  "edgeLabels",
  "clusters",
  "output",
  "rootDoc",
  "marker",
]);

const collapse = (s: string) => s.replace(/\s+/g, " ").trim();

function isStructural(el: Element): boolean {
  for (const c of Array.from(el.classList)) if (STRUCTURAL.has(c)) return true;
  return false;
}

/** Child-index path from the svg root, used when no semantic id is available. */
function pathOf(el: Element, root: Element): string {
  const steps: string[] = [];
  let node: Element | null = el;
  while (node && node !== root) {
    const parent: Element | null = node.parentElement;
    if (!parent) break;
    steps.unshift(String(Array.prototype.indexOf.call(parent.children, node)));
    node = parent;
  }
  return steps.join("/");
}

function elementFromPath(root: Element, path: string): Element | null {
  if (!path) return null;
  let node: Element | null = root;
  for (const step of path.split("/")) {
    const idx = Number(step);
    node = node?.children[idx] ?? null;
    if (!node) return null;
  }
  return node;
}

/** Drop the per-render prefix mermaid puts on every id it emits. */
function stripRenderId(id: string, renderId: string): string {
  if (!id) return "";
  return renderId && id.startsWith(`${renderId}-`) ? id.slice(renderId.length + 1) : id;
}

function kindFromClass(el: Element): string {
  const cl = el.classList;
  if (cl.contains("node")) return "node";
  if (cl.contains("cluster")) return "subgraph";
  if (cl.contains("edgeLabel")) return "label";
  if (cl.contains("messageText")) return "message label";
  if (cl.contains("actor")) return "participant";
  if (cl.contains("note")) return "note";
  if (cl.contains("task")) return "task";
  if (cl.contains("section")) return "section";
  return el.tagName.toLowerCase() === "g" ? "group" : "shape";
}

/** A readable name for the part — the sidebar quote and the export label. */
function labelFor(el: Element, kind: string, key: string): string {
  const text = collapse(el.textContent ?? "");
  if (text) return text;
  const from = el.getAttribute("data-from");
  const to = el.getAttribute("data-to");
  if (from && to) return `${from} → ${to}`;
  // Flowchart links are keyed L_<from>_<to>_<n>.
  const link = /^L_(.+)_(\d+)$/.exec(key);
  if (link) {
    const [a, b] = link[1].split("_");
    if (a && b) return `${a} → ${b}`;
  }
  if (kind === "lifeline") return `${key} lifeline`;
  return key ? `${kind} ${key}` : kind;
}

function describe(el: Element, svg: SVGSVGElement, block: string): DiagramPart {
  const et = el.getAttribute("data-et");
  const kind = et ? (KIND_BY_ET[et] ?? et) : kindFromClass(el);
  const key = el.getAttribute("data-id") ?? stripRenderId(el.id, svg.id);
  return { block, kind, key, path: pathOf(el, svg), label: labelFor(el, kind, key) };
}

/** The element a pointer at (x, y) addresses, or null over empty canvas. */
export function partAt(
  target: Element,
  svg: SVGSVGElement,
  block: string,
  point?: { x: number; y: number },
): { el: Element; part: DiagramPart } | null {
  if (!svg.contains(target) && target !== svg) return null;
  // Prefer mermaid's own semantic wrapper (a participant group, an edge) over
  // whatever inner shape or label the pointer happened to land on — that's what
  // carries the id the comment will be re-anchored by.
  const semantic = target.closest("[data-et]");
  if (semantic && svg.contains(semantic)) {
    return { el: semantic, part: describe(semantic, svg, block) };
  }
  const direct = target.closest(PART_SELECTOR);
  if (direct && svg.contains(direct) && !isStructural(direct)) {
    return { el: direct, part: describe(direct, svg, block) };
  }
  // Thin strokes are hard to hit dead-on: fall back to the nearest edge.
  if (point) {
    const near = nearestLine(svg, point.x, point.y);
    if (near) return { el: near, part: describe(near, svg, block) };
  }
  return null;
}

/** Nearest stroked element to a viewport point, within `tolerance` px. */
export function nearestLine(
  svg: SVGSVGElement,
  clientX: number,
  clientY: number,
  tolerance = 14,
): Element | null {
  let best: Element | null = null;
  let bestDist = tolerance;
  for (const el of Array.from(svg.querySelectorAll(LINE_SELECTOR))) {
    const geo = el as SVGGeometryElement;
    if (typeof geo.getTotalLength !== "function") continue;
    const ctm = geo.getScreenCTM();
    if (!ctm) continue;
    let len = 0;
    try {
      len = geo.getTotalLength();
    } catch {
      continue;
    }
    const steps = Math.min(28, Math.max(4, Math.round(len / 14)));
    for (let i = 0; i <= steps; i++) {
      const p = geo.getPointAtLength((len * i) / steps);
      const x = ctm.a * p.x + ctm.c * p.y + ctm.e;
      const y = ctm.b * p.x + ctm.d * p.y + ctm.f;
      const d = Math.hypot(x - clientX, y - clientY);
      if (d < bestDist) {
        bestDist = d;
        best = el;
      }
    }
  }
  return best;
}

const etForKind = (kind: string): string => {
  const et = Object.keys(KIND_BY_ET).find((k) => KIND_BY_ET[k] === kind);
  return et ? `[data-et="${et}"]` : "";
};

const escape = (s: string) =>
  typeof CSS !== "undefined" && CSS.escape ? CSS.escape(s) : s.replace(/["\\]/g, "\\$&");

/**
 * Find the element a stored part refers to in the *current* SVG. Strategies run
 * from strongest to weakest: mermaid's semantic id, the prefixed DOM id, the
 * same id with a shifted trailing index, then the label.
 *
 * The positional path is only a fallback for parts that never had an id. A part
 * that *did* have one and can no longer be found is genuinely gone — resolving
 * it by position would silently move the comment onto whatever now occupies
 * that slot, and hide the fact that the diagram lost it.
 */
export function resolvePart(svg: SVGSVGElement, part: DiagramPart): Element | null {
  const { key, kind, path, label } = part;
  const attempts: Array<() => Element | null> = [
    () => (key ? svg.querySelector(`[data-id="${escape(key)}"]${etForKind(kind)}`) : null),
    () => (key ? svg.querySelector(`#${escape(`${svg.id}-${key}`)}`) : null),
    () => (key ? relaxedIndex(svg, key) : null),
    () => byLabel(svg, kind, label),
    () => (key ? null : elementFromPath(svg, path)),
  ];
  for (const attempt of attempts) {
    let el: Element | null = null;
    try {
      el = attempt();
    } catch {
      el = null;
    }
    if (el && svg.contains(el)) return el;
  }
  return null;
}

/** `flowchart-A-0` still matches `flowchart-A-3` when the graph gained nodes. */
function relaxedIndex(svg: SVGSVGElement, key: string): Element | null {
  const base = key.replace(/-\d+$/, "");
  if (base === key) return null;
  const prefix = `${svg.id}-${base}-`;
  for (const el of Array.from(svg.querySelectorAll("[id]"))) {
    if (el.id.startsWith(prefix) && /^\d+$/.test(el.id.slice(prefix.length))) return el;
  }
  return null;
}

function byLabel(svg: SVGSVGElement, kind: string, label: string): Element | null {
  if (!label) return null;
  for (const el of Array.from(svg.querySelectorAll(PART_SELECTOR))) {
    if (isStructural(el)) continue;
    if (collapse(el.textContent ?? "") !== label) continue;
    const et = el.getAttribute("data-et");
    const elKind = et ? (KIND_BY_ET[et] ?? et) : kindFromClass(el);
    if (elKind === kind) return el;
  }
  return null;
}
