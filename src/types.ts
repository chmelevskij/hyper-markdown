/** A persisted text anchor for a highlight, modeled on the W3C annotation selectors. */
export interface Anchor {
  /** Exact selected text. */
  quote: string;
  /** ~32 chars of context immediately before the quote (for re-locating). */
  prefix: string;
  /** ~32 chars of context immediately after the quote. */
  suffix: string;
  /** Character offsets into the rendered root's text content (fast path). */
  start: number;
  end: number;
  /** Source line range in the original Markdown, when resolvable. */
  sourceLineStart?: number;
  sourceLineEnd?: number;
}

export type CommentStatus = "open" | "resolved";

export interface Comment {
  id: string;
  /** Document the comment belongs to (absolute path, or "untitled" in browser). */
  documentPath: string;
  createdAt: string;
  updatedAt: string;
  /** The user's note, fed back to the agent. */
  body: string;
  status: CommentStatus;
  color: string;
  anchor: Anchor;
}

export interface LoadedDocument {
  /** Absolute path (Tauri) or synthetic id (browser drag-drop). */
  path: string;
  /** Display name. */
  name: string;
  /** Raw file contents. */
  source: string;
  /** Rendering format derived from the extension. */
  format: "md" | "mdx";
}

/** Serialized sidecar file written next to a document / into app data. */
export interface CommentFile {
  version: 1;
  document: string;
  comments: Comment[];
}
