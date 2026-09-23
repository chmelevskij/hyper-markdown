/**
 * A part of a rendered Mermaid diagram (a node, an edge, a subgraph, a
 * participant…). Mermaid v11 stamps its own semantic ids onto the SVG, so a
 * part can be re-found after a re-render even though the surrounding element
 * ids carry a fresh per-render prefix each time.
 */
export interface DiagramPart {
  /** Which ```mermaid block in the document (its fence start line, else a code hash). */
  block: string;
  /** node | edge | subgraph | participant | message | lifeline | label | … */
  kind: string;
  /** Identity within the diagram, from mermaid's own ids ("flowchart-A-0", "L_A_B_0", "Bob"). */
  key: string;
  /** Structural fallback: child-index path from the <svg> root. */
  path: string;
  /** Visible label at capture time; doubles as a last-resort matcher. */
  label: string;
}

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
  /**
   * Set when the comment targets a piece of a rendered diagram instead of a
   * text range. The text fields still carry the part's label and the fenced
   * block's line range, so the sidebar, export and sidecar format are unchanged.
   */
  part?: DiagramPart;
}

export type CommentStatus = "open" | "resolved";

/** Snapshot of the source the comment was made against, used to detect edits. */
export interface Baseline {
  /** Hash of the full document source at capture time. */
  docHash: string;
  /** The source slice (by line range) the comment anchored to. */
  sourceText: string;
  lineStart?: number;
  lineEnd?: number;
  capturedAt: string;
}

/** A pull request a document's comments are linked to. */
export interface GithubPr {
  owner: string;
  repo: string;
  number: number;
  url: string;
  /** Head commit the last pull anchored against. */
  headSha?: string;
  /** Document path relative to the repository root. */
  path: string;
}

/** Where a comment lives on GitHub, once it has been pulled from or pushed to a PR. */
export interface GithubLink {
  /** REST id of the thread's first review comment. */
  commentId: number;
  /** GraphQL node id of that comment. */
  nodeId: string;
  /** GraphQL id of the review thread — needed to resolve / unresolve. Learned on pull. */
  threadId?: string;
  url: string;
  author: string;
  /** Thread resolved state on GitHub as of the last sync. */
  remoteResolved: boolean;
  /** Body as composed from the remote thread at last sync, to detect local edits. */
  remoteBody: string;
  syncedAt: string;
}

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
  baseline?: Baseline;
  /** Present once the comment is mirrored on a GitHub pull request. */
  github?: GithubLink;
}

/** How the source under a comment compares to its baseline (derived at runtime). */
export type AddressState = "untouched" | "edited" | "removed";

export interface CommentChange {
  state: AddressState;
  /** Baseline source slice (for edited / removed). */
  wasText?: string;
  /** Current source slice at the re-anchored location (for edited). */
  nowText?: string;
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
  version: 1 | 2 | 3;
  document: string;
  comments: Comment[];
  /** v3: the pull request this document's comments sync with. */
  github?: GithubPr | null;
}
