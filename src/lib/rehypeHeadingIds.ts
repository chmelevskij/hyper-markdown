import { visit } from "unist-util-visit";
import type { Root, Element, ElementContent } from "hast";

const HEADINGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);

/** Collect the visible text of a hast element (recursively). */
function textOf(node: ElementContent): string {
  if (node.type === "text") return node.value;
  if (node.type === "element") return node.children.map(textOf).join("");
  return "";
}

/**
 * GitHub-style slug: lowercase, drop punctuation (keep word chars, spaces, hyphens),
 * then collapse whitespace to hyphens. Good enough for in-document `#anchor` links.
 */
function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-");
}

/**
 * Assigns a stable `id` to every heading (matching the slug GitHub would produce),
 * deduping collisions with a numeric suffix. This is what makes in-page anchor
 * links like `[Jump](#some-heading)` resolve to a real element to scroll to.
 */
export default function rehypeHeadingIds() {
  return (tree: Root) => {
    const seen = new Map<string, number>();
    visit(tree, "element", (node: Element) => {
      if (!HEADINGS.has(node.tagName)) return;
      node.properties = node.properties || {};
      if (node.properties.id) return; // respect an explicit id
      const base = slugify(node.children.map(textOf).join("")) || "section";
      const count = seen.get(base) ?? 0;
      seen.set(base, count + 1);
      node.properties.id = count === 0 ? base : `${base}-${count}`;
    });
  };
}
