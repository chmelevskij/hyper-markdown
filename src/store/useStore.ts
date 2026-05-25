import { create } from "zustand";
import type { Anchor, Comment, CommentChange, CommentFile, LoadedDocument } from "../types";
import { platform } from "../platform";
import { uid } from "../lib/id";
import { hashSource, sliceSourceLines } from "../lib/changes";
import type { ImportedComment } from "../lib/importComments";

export type Mode = "light" | "dark";
/** Reading = plain reader; comment = highlight + annotate with the sidebar. */
export type ViewMode = "reading" | "comment";

/** Solarized accent hues, used for comment swatches + highlight buckets. */
export const HIGHLIGHT_COLORS = [
  "#b58900", // yellow
  "#2aa198", // cyan
  "#268bd2", // blue
  "#d33682", // magenta
  "#6c71c4", // violet
];

interface AppState {
  doc: LoadedDocument | null;
  comments: Comment[];
  selectedId: string | null;
  mode: Mode;
  viewMode: ViewMode;
  safeMode: boolean;
  showResolved: boolean;
  sidebarWidth: number;
  /** Per-comment change state vs. baseline (derived after each render). */
  changes: Record<string, CommentChange>;
  /** Bumped whenever the rendered DOM changes so highlights re-resolve. */
  renderNonce: number;

  loadDocument: (doc: LoadedDocument) => Promise<void>;
  openDocument: () => Promise<void>;

  addComment: (anchor: Anchor, body: string) => string;
  importComments: (list: ImportedComment[]) => number;
  updateComment: (id: string, patch: Partial<Pick<Comment, "body" | "status">>) => void;
  resolveAsAddressed: (id: string) => void;
  deleteComment: (id: string) => void;
  selectComment: (id: string | null) => void;
  setChanges: (changes: Record<string, CommentChange>) => void;

  setMode: (m: Mode) => void;
  setViewMode: (v: ViewMode) => void;
  toggleSafeMode: () => void;
  toggleShowResolved: () => void;
  setSidebarWidth: (w: number) => void;
  bumpRender: () => void;
}

const LS_PREFS = "hmd:prefs";

export const SIDEBAR_MIN = 260;
export const SIDEBAR_MAX = 620;

type Prefs = Pick<
  AppState,
  "mode" | "viewMode" | "safeMode" | "sidebarWidth"
>;

const DEFAULT_PREFS: Prefs = {
  mode: "light",
  viewMode: "comment",
  safeMode: false,
  sidebarWidth: 340,
};

function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(LS_PREFS);
    if (raw) return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return DEFAULT_PREFS;
}

function savePrefs(s: AppState) {
  const prefs: Prefs = {
    mode: s.mode,
    viewMode: s.viewMode,
    safeMode: s.safeMode,
    sidebarWidth: s.sidebarWidth,
  };
  localStorage.setItem(LS_PREFS, JSON.stringify(prefs));
}

const clampWidth = (w: number) => Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, w));

async function persistComments(doc: LoadedDocument | null, comments: Comment[]) {
  if (!doc) return;
  const file: CommentFile = { version: 2, document: doc.path, comments };
  try {
    await platform.saveComments(doc.path, JSON.stringify(file, null, 2));
  } catch (e) {
    console.error("Failed to persist comments", e);
  }
}

export const useStore = create<AppState>((set, get) => ({
  doc: null,
  comments: [],
  selectedId: null,
  ...loadPrefs(),
  showResolved: false,
  changes: {},
  renderNonce: 0,

  async loadDocument(doc) {
    set({ doc, comments: [], selectedId: null, changes: {} });
    set((s) => ({ renderNonce: s.renderNonce + 1 }));
    // Hydrate any saved comments for this document.
    try {
      const raw = await platform.loadComments(doc.path);
      if (raw) {
        const parsed = JSON.parse(raw) as CommentFile;
        if (Array.isArray(parsed.comments)) set({ comments: parsed.comments });
      }
    } catch (e) {
      console.error("Failed to load comments", e);
    }
  },

  async openDocument() {
    const doc = await platform.openDocument();
    if (doc) await get().loadDocument(doc);
  },

  addComment(anchor, body) {
    const id = uid();
    const now = new Date().toISOString();
    const { comments, doc } = get();
    const color = HIGHLIGHT_COLORS[comments.length % HIGHLIGHT_COLORS.length];
    const baseline = doc
      ? {
          docHash: hashSource(doc.source),
          sourceText:
            anchor.sourceLineStart != null
              ? sliceSourceLines(
                  doc.source,
                  anchor.sourceLineStart,
                  anchor.sourceLineEnd ?? anchor.sourceLineStart,
                )
              : anchor.quote,
          lineStart: anchor.sourceLineStart,
          lineEnd: anchor.sourceLineEnd,
          capturedAt: now,
        }
      : undefined;
    const comment: Comment = {
      id,
      documentPath: doc?.path ?? "untitled",
      createdAt: now,
      updatedAt: now,
      body,
      status: "open",
      color,
      anchor,
      baseline,
    };
    const next = [...comments, comment];
    set({ comments: next, selectedId: id });
    persistComments(doc, next);
    return id;
  },

  importComments(list) {
    const { comments, doc } = get();
    const now = new Date().toISOString();
    const added: Comment[] = list.map((c, idx) => ({
      id: uid(),
      documentPath: doc?.path ?? "untitled",
      createdAt: now,
      updatedAt: now,
      body: c.body,
      status: c.status,
      color: c.color ?? HIGHLIGHT_COLORS[(comments.length + idx) % HIGHLIGHT_COLORS.length],
      anchor: c.anchor,
    }));
    const next = [...comments, ...added];
    set({ comments: next });
    persistComments(doc, next);
    return added.length;
  },

  updateComment(id, patch) {
    const { comments, doc } = get();
    const next = comments.map((c) =>
      c.id === id ? { ...c, ...patch, updatedAt: new Date().toISOString() } : c,
    );
    set({ comments: next });
    persistComments(doc, next);
  },

  resolveAsAddressed(id) {
    const { comments, doc, changes } = get();
    const now = new Date().toISOString();
    const ch = changes[id];
    const next = comments.map((c) => {
      if (c.id !== id) return c;
      // Re-baseline to the current source so a reopened comment reads "untouched".
      const baseline =
        doc && c.baseline
          ? {
              ...c.baseline,
              docHash: hashSource(doc.source),
              sourceText: ch?.nowText ?? c.baseline.sourceText,
              capturedAt: now,
            }
          : c.baseline;
      return { ...c, status: "resolved" as const, baseline, updatedAt: now };
    });
    set({ comments: next });
    persistComments(doc, next);
  },

  deleteComment(id) {
    const { comments, doc, selectedId } = get();
    const next = comments.filter((c) => c.id !== id);
    set({ comments: next, selectedId: selectedId === id ? null : selectedId });
    persistComments(doc, next);
  },

  selectComment(id) {
    set({ selectedId: id });
  },

  setChanges(changes) {
    set({ changes });
  },

  setMode(mode) {
    set({ mode });
    savePrefs(get());
  },
  setViewMode(viewMode) {
    set({ viewMode });
    savePrefs(get());
  },
  toggleSafeMode() {
    set((s) => ({ safeMode: !s.safeMode }));
    set((s) => ({ renderNonce: s.renderNonce + 1 }));
    savePrefs(get());
  },
  toggleShowResolved() {
    set((s) => ({ showResolved: !s.showResolved }));
  },
  setSidebarWidth(w) {
    set({ sidebarWidth: clampWidth(w) });
    savePrefs(get());
  },
  bumpRender() {
    set((s) => ({ renderNonce: s.renderNonce + 1 }));
  },
}));

// Dev affordance: expose the store for debugging in the browser preview.
if (import.meta.env.DEV) {
  (window as unknown as { __store: typeof useStore }).__store = useStore;
}
