import type { Anchor } from "../types";

const CONTEXT = 32;

/** Total text offset of (node, offset) within root, walking text nodes in order. */
function offsetOf(root: Node, node: Node, nodeOffset: number): number {
  // If the boundary is in an element, translate the child index to a text offset.
  if (node.nodeType === Node.ELEMENT_NODE) {
    const children = node.childNodes;
    if (nodeOffset < children.length) return textLengthBefore(root, children[nodeOffset]);
    // Boundary sits after the last child → end of this element's text.
    return textLengthBefore(root, node) + (node.textContent?.length ?? 0);
  }
  return textLengthBefore(root, node) + nodeOffset;
}

/** Length of all text that precedes `target` in document order under `root`. */
function textLengthBefore(root: Node, target: Node): number {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let count = 0;
  let n: Node | null;
  while ((n = walker.nextNode())) {
    if (n === target) return count;
    if (target.contains(n)) return count;
    count += n.textContent?.length ?? 0;
  }
  return count;
}

/** Nearest ancestor element line attribute, climbing from a boundary node. */
function lineFromNode(node: Node, attr: "data-src-start" | "data-src-end"): number | undefined {
  const el = (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement) as Element | null;
  const found = el?.closest(`[${attr}]`);
  const value = found?.getAttribute(attr);
  return value ? Number(value) : undefined;
}

/**
 * Source line range covered by a live range, read from the rendered DOM stamps.
 * A boundary can land on inter-block whitespace (MDX emits "\n" text nodes whose
 * parent is the article, with no line stamp), so each side falls back to the
 * other boundary when its own lookup misses.
 */
export function sourceLinesForRange(range: Range): { start?: number; end?: number } {
  const start =
    lineFromNode(range.startContainer, "data-src-start") ??
    lineFromNode(range.endContainer, "data-src-start");
  const end =
    lineFromNode(range.endContainer, "data-src-end") ??
    lineFromNode(range.startContainer, "data-src-end");
  return { start, end };
}

/** Build a persistent anchor from a live selection range. */
export function captureAnchor(root: HTMLElement, range: Range): Anchor {
  const full = root.textContent ?? "";
  const start = offsetOf(root, range.startContainer, range.startOffset);
  const end = offsetOf(root, range.endContainer, range.endOffset);
  const lo = Math.min(start, end);
  const hi = Math.max(start, end);
  return {
    quote: full.slice(lo, hi),
    prefix: full.slice(Math.max(0, lo - CONTEXT), lo),
    suffix: full.slice(hi, hi + CONTEXT),
    start: lo,
    end: hi,
    sourceLineStart: lineFromNode(range.startContainer, "data-src-start"),
    sourceLineEnd: lineFromNode(range.endContainer, "data-src-end"),
  };
}

/** Convert text offsets back into a DOM Range under root. */
function rangeFromOffsets(root: HTMLElement, start: number, end: number): Range | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let count = 0;
  let startSet = false;
  let n: Node | null;
  while ((n = walker.nextNode())) {
    const len = n.textContent?.length ?? 0;
    if (!startSet && count + len >= start) {
      range.setStart(n, start - count);
      startSet = true;
    }
    if (startSet && count + len >= end) {
      range.setEnd(n, end - count);
      return range;
    }
    count += len;
  }
  return startSet ? range : null;
}

/**
 * Resolve an anchor to a Range in the current DOM. Tries the stored offsets
 * first (validated against the quote), then falls back to a prefix/quote/suffix
 * text search so highlights survive small edits and re-renders.
 *
 * Single-shot convenience — when resolving more than one anchor against the
 * same root, prefer `createResolver` so the (expensive) `root.textContent` read
 * and per-anchor results are shared.
 */
export function resolveRange(root: HTMLElement, anchor: Anchor): Range | null {
  return resolveAgainstText(root, root.textContent ?? "", anchor);
}

/**
 * Batched anchor resolver. Reads `root.textContent` once and memoizes the
 * resolved Range per anchor (by object identity) for the resolver's lifetime —
 * a single React render pass that resolves N comments goes from N full-document
 * text reads + N TreeWalker traversals to one of each (plus per-anchor work).
 */
export function createResolver(root: HTMLElement): (anchor: Anchor) => Range | null {
  const full = root.textContent ?? "";
  const cache = new Map<Anchor, Range | null>();
  return (anchor) => {
    if (cache.has(anchor)) return cache.get(anchor) ?? null;
    const range = resolveAgainstText(root, full, anchor);
    cache.set(anchor, range);
    return range;
  };
}

function resolveAgainstText(root: HTMLElement, full: string, anchor: Anchor): Range | null {
  // Fast path: stored offsets still point at the same text.
  if (full.slice(anchor.start, anchor.end) === anchor.quote) {
    return rangeFromOffsets(root, anchor.start, anchor.end);
  }

  // Fallback: locate the quote, preferring the occurrence whose surrounding
  // context best matches the stored prefix/suffix.
  if (!anchor.quote) return null;
  let bestIndex = -1;
  let bestScore = -1;
  let from = 0;
  for (;;) {
    const idx = full.indexOf(anchor.quote, from);
    if (idx === -1) break;
    const before = full.slice(Math.max(0, idx - CONTEXT), idx);
    const after = full.slice(idx + anchor.quote.length, idx + anchor.quote.length + CONTEXT);
    const score = commonSuffix(before, anchor.prefix) + commonPrefix(after, anchor.suffix);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = idx;
    }
    from = idx + 1;
  }
  if (bestIndex !== -1) {
    return rangeFromOffsets(root, bestIndex, bestIndex + anchor.quote.length);
  }

  // Last resort: the quote is source Markdown that never appears verbatim in
  // the rendered text (imported or pulled from GitHub). Cover the blocks that
  // were rendered from its source lines instead.
  if (anchor.sourceLineStart != null) {
    return rangeFromSourceLines(root, anchor.sourceLineStart, anchor.sourceLineEnd ?? anchor.sourceLineStart);
  }
  return null;
}

/**
 * A Range spanning every line-stamped block that overlaps the given 1-based
 * source line range, or null when nothing rendered from those lines.
 */
export function rangeFromSourceLines(root: HTMLElement, start: number, end: number): Range | null {
  const lo = Math.min(start, end);
  const hi = Math.max(start, end);
  let first: Element | null = null;
  let last: Element | null = null;
  for (const el of root.querySelectorAll<HTMLElement>("[data-src-start]")) {
    const s = Number(el.dataset.srcStart);
    const e = Number(el.dataset.srcEnd ?? el.dataset.srcStart);
    if (Number.isNaN(s) || e < lo || s > hi) continue;
    // Skip ancestors that merely contain an already-chosen block, so a list
    // item does not widen the range to its whole list.
    if (first && el.contains(first)) continue;
    if (!first) first = el;
    last = el;
  }
  if (!first || !last) return null;
  const range = document.createRange();
  range.setStart(first, 0);
  range.setEnd(last, last.childNodes.length);
  return range.collapsed ? null : range;
}

function commonPrefix(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

function commonSuffix(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[a.length - 1 - i] === b[b.length - 1 - i]) i++;
  return i;
}
