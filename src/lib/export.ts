import type { Comment } from "../types";

function lineLabel(c: Comment): string {
  const { sourceLineStart: s, sourceLineEnd: e } = c.anchor;
  if (s == null) return "";
  if (e == null || e === s) return ` · line ${s}`;
  return ` · lines ${s}–${e}`;
}

function blockQuote(text: string): string {
  return text
    .split("\n")
    .map((l) => `> ${l}`)
    .join("\n");
}

export interface ExportOptions {
  /** Only include open comments (default) or everything. */
  includeResolved: boolean;
}

/** Build the Markdown payload an agent reads: quoted source + line refs + notes. */
export function toMarkdown(
  documentName: string,
  comments: Comment[],
  opts: ExportOptions = { includeResolved: false },
): string {
  const items = comments.filter((c) => opts.includeResolved || c.status === "open");
  const date = new Date().toISOString().slice(0, 10);
  const header = `# Review comments — ${documentName}\n_${items.length} comment${
    items.length === 1 ? "" : "s"
  } • exported ${date}_\n`;

  if (items.length === 0) {
    return `${header}\n_No comments._\n`;
  }

  const body = items
    .map((c, i) => {
      const status = c.status === "resolved" ? " _(resolved)_" : "";
      return [
        `## ${i + 1}${lineLabel(c)}${status}`,
        "",
        blockQuote(c.anchor.quote),
        "",
        `**Comment:** ${c.body || "_(no note)_"}`,
      ].join("\n");
    })
    .join("\n\n---\n\n");

  return `${header}\n${body}\n`;
}

/** Machine-readable variant for tooling / future MCP integration. */
export function toJSON(
  documentName: string,
  comments: Comment[],
  opts: ExportOptions = { includeResolved: false },
): string {
  const items = comments
    .filter((c) => opts.includeResolved || c.status === "open")
    .map((c) => ({
      id: c.id,
      lines:
        c.anchor.sourceLineStart != null
          ? [c.anchor.sourceLineStart, c.anchor.sourceLineEnd ?? c.anchor.sourceLineStart]
          : null,
      quote: c.anchor.quote,
      body: c.body,
      status: c.status,
    }));
  return JSON.stringify({ document: documentName, exported: new Date().toISOString(), comments: items }, null, 2);
}
