import type { Anchor, Baseline, CommentStatus } from "../types";

/** A comment recovered from an exported file, pre-anchor-reconstruction. */
export interface ImportedComment {
  body: string;
  status: CommentStatus;
  /** Full anchor when importing a sidecar file; partial (quote + lines) otherwise. */
  anchor: Anchor;
  color?: string;
  /** Source snapshot when the importer knows it (e.g. the PR head commit). */
  baseline?: Baseline;
}

function makeAnchor(partial: Partial<Anchor> & { quote: string }): Anchor {
  return {
    quote: partial.quote,
    prefix: partial.prefix ?? "",
    suffix: partial.suffix ?? "",
    start: partial.start ?? 0,
    end: partial.end ?? 0,
    sourceLineStart: partial.sourceLineStart,
    sourceLineEnd: partial.sourceLineEnd,
  };
}

function fromJSON(text: string): ImportedComment[] {
  const data = JSON.parse(text);
  const list = Array.isArray(data) ? data : data.comments;
  if (!Array.isArray(list)) throw new Error("No `comments` array found in JSON.");

  return list
    .map((c): ImportedComment | null => {
      // Full sidecar comment (has a complete anchor object).
      if (c.anchor && typeof c.anchor.quote === "string") {
        return {
          body: c.body ?? "",
          status: c.status === "resolved" ? "resolved" : "open",
          anchor: makeAnchor(c.anchor),
          color: c.color,
        };
      }
      // Export JSON: { lines: [s,e]|null, quote, body, status }.
      if (typeof c.quote === "string") {
        const [s, e] = Array.isArray(c.lines) ? c.lines : [undefined, undefined];
        return {
          body: c.body ?? "",
          status: c.status === "resolved" ? "resolved" : "open",
          anchor: makeAnchor({ quote: c.quote, sourceLineStart: s, sourceLineEnd: e }),
        };
      }
      return null;
    })
    .filter((c): c is ImportedComment => c !== null);
}

const SECTION_RE = /^##\s+\d+(.*)$/;
const LINES_RE = /lines?\s+(\d+)(?:[–\-](\d+))?/i;

function fromMarkdown(text: string): ImportedComment[] {
  const lines = text.split(/\r?\n/);
  const out: ImportedComment[] = [];
  let i = 0;

  while (i < lines.length) {
    const header = SECTION_RE.exec(lines[i]);
    if (!header) {
      i++;
      continue;
    }
    const meta = header[1];
    const status: CommentStatus = /\(resolved\)/i.test(meta) ? "resolved" : "open";
    const lm = LINES_RE.exec(meta);
    const sourceLineStart = lm ? Number(lm[1]) : undefined;
    const sourceLineEnd = lm && lm[2] ? Number(lm[2]) : sourceLineStart;
    i++;

    // Collect the blockquote (quoted source) and the comment body.
    const quoteLines: string[] = [];
    let body = "";
    while (i < lines.length && !SECTION_RE.test(lines[i])) {
      const line = lines[i];
      if (line.startsWith(">")) {
        quoteLines.push(line.replace(/^>\s?/, ""));
      } else if (/^\*\*Comment:\*\*/.test(line)) {
        body = line.replace(/^\*\*Comment:\*\*\s*/, "");
      } else if (body && line.trim() && line.trim() !== "---") {
        // Continuation lines of a multi-line comment body.
        body += `\n${line}`;
      }
      i++;
    }

    const quote = quoteLines.join("\n").trim();
    if (!quote) continue;
    out.push({
      body: body.trim() === "_(no note)_" ? "" : body.trim(),
      status,
      anchor: makeAnchor({ quote, sourceLineStart, sourceLineEnd }),
    });
  }
  return out;
}

/** Parse an exported comments file (`.md` or `.json`) back into comments. */
export function parseImport(text: string, filename: string): ImportedComment[] {
  const looksJSON = filename.toLowerCase().endsWith(".json") || /^\s*[[{]/.test(text);
  return looksJSON ? fromJSON(text) : fromMarkdown(text);
}
