import type { Comment } from "../types";

function lineLabel(c: Comment): string {
  const { sourceLineStart: s, sourceLineEnd: e } = c.anchor;
  if (s == null) return "";
  if (e == null || e === s) return ` · line ${s}`;
  return ` · lines ${s}–${e}`;
}

/** " · diagram node “Start”" for comments anchored into a rendered diagram. */
function partLabel(c: Comment): string {
  const part = c.anchor.part;
  return part ? ` · diagram ${part.kind} “${c.anchor.quote}”` : "";
}

/**
 * What to quote back at the agent. Diagram comments quote the whole fenced
 * block (captured in the baseline) so the source it needs to edit is right
 * there; the part itself is named in the heading.
 */
function quotedSource(c: Comment): string {
  if (!c.anchor.part) return c.anchor.quote;
  return c.baseline?.sourceText || c.anchor.quote;
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
        `## ${i + 1}${lineLabel(c)}${partLabel(c)}${status}`,
        "",
        blockQuote(quotedSource(c)),
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
      quote: quotedSource(c),
      diagram: c.anchor.part
        ? { kind: c.anchor.part.kind, key: c.anchor.part.key, label: c.anchor.quote }
        : null,
      body: c.body,
      status: c.status,
    }));
  return JSON.stringify({ document: documentName, exported: new Date().toISOString(), comments: items }, null, 2);
}
