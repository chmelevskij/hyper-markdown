/**
 * Helpers for detecting whether the source under a comment changed since the
 * comment was made. Everything operates on the raw document source (not the
 * rendered output), so it behaves identically for Markdown and MDX.
 */

/** Fast, dependency-free string hash (cyrb53) → hex string. */
export function hashSource(str: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}

/** 1-based, inclusive slice of source by line range. */
export function sliceSourceLines(source: string, start: number, end: number): string {
  return source.split("\n").slice(Math.max(0, start - 1), end).join("\n");
}

/** Normalize for comparison: ignore trailing whitespace and outer blank lines. */
export function normalizeForCompare(s: string): string {
  return s.replace(/[ \t]+$/gm, "").trim();
}
