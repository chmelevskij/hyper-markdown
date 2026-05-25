import { visit } from "unist-util-visit";
import type { Root, Element } from "hast";

/**
 * Stamps `data-src-start` / `data-src-end` (1-based source line numbers) onto
 * every block-level element that carries position info from the parser. This is
 * what lets a DOM selection report back precise Markdown line ranges for the
 * agent export.
 */
export default function rehypeSourceLine() {
  return (tree: Root) => {
    visit(tree, "element", (node: Element) => {
      const pos = node.position;
      if (!pos?.start?.line || !pos?.end?.line) return;
      node.properties = node.properties || {};
      node.properties["dataSrcStart"] = pos.start.line;
      node.properties["dataSrcEnd"] = pos.end.line;
    });
  };
}
