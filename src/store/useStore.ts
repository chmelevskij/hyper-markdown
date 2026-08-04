import { create } from "zustand";
import type { Anchor, Comment, CommentChange, CommentFile, LoadedDocument } from "../types";
import { platform } from "../platform";
import { uid } from "../lib/id";
import { hashSource, sliceSourceLines } from "../lib/changes";
import type { ImportedComment } from "../lib/importComments";

export type Mode = "light" | "dark";
/** Reading = plain reader; comment = highlight + annotate with the sidebar. */
export type ViewMode = "reading" | "comment";

/** Solid counterparts of the --hl-0..4 wash tones in themes.css, used for
    comment swatches + highlight buckets. */
export const HIGHLIGHT_COLORS = [
  "#c4963a", // ochre
  "#6e8e80", // sage
  "#68809c", // slate
  "#a86e7a", // dusk rose
  "#7e769e", // heather
];

/** One open document and all of its per-document state. */
export interface Tab {
  id: string;
  doc: LoadedDocument;
  comments: Comment[];
  selectedId: string | null;
  changes: Record<string, CommentChange>;
  /** Bumped whenever this tab's rendered DOM changes so highlights re-resolve. */
  renderNonce: number;
  /**
   * Heading id a cross-document `#anchor` link asked us to land on. The target
   * heading does not exist until this tab has rendered, so DocumentView consumes
   * it once the content is on screen rather than at load time.
   */
  pendingFragment?: string | null;
}

interface AppState {
  tabs: Tab[];
  activeTabId: string | null;
  mode: Mode;
  viewMode: ViewMode;
  safeMode: boolean;
  showResolved: boolean;
  sidebarWidth: number;
  /** Max width (px) of the rendered text column. */
  contentWidth: number;

  /** `fragment` is a heading id to scroll to once the document has rendered. */
  loadDocument: (doc: LoadedDocument, fragment?: string) => Promise<void>;
  clearPendingFragment: (id: string) => void;
  openDocument: () => Promise<void>;
  restoreSession: () => Promise<void>;
  closeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  /** Replace a tab's source after an external edit (live reload). */
  reloadTabByPath: (path: string, source: string) => void;

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
  setContentWidth: (w: number) => void;
  bumpRender: () => void;
}

const LS_PREFS = "hmd:prefs";
const LS_SESSION = "hmd:session";

export const SIDEBAR_MIN = 260;
export const SIDEBAR_MAX = 620;

/** Text column bounds — narrow enough to stay readable, wide enough for tables. */
export const CONTENT_MIN = 480;
export const CONTENT_MAX = 1600;
export const CONTENT_DEFAULT = 740;

/** Stable empties so selectors don't allocate when there is no active tab. */
const EMPTY_COMMENTS: Comment[] = [];
const EMPTY_CHANGES: Record<string, CommentChange> = {};

/** Selector: the currently active tab (or undefined). */
export const activeTab = (s: AppState): Tab | undefined =>
  s.tabs.find((t) => t.id === s.activeTabId);

export const activeComments = (s: AppState): Comment[] =>
  activeTab(s)?.comments ?? EMPTY_COMMENTS;
export const activeChanges = (s: AppState): Record<string, CommentChange> =>
  activeTab(s)?.changes ?? EMPTY_CHANGES;

type Prefs = Pick<
  AppState,
  "mode" | "viewMode" | "safeMode" | "sidebarWidth" | "contentWidth"
>;

const DEFAULT_PREFS: Prefs = {
  mode: "light",
  viewMode: "comment",
  safeMode: false,
  sidebarWidth: 340,
  contentWidth: CONTENT_DEFAULT,
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
    contentWidth: s.contentWidth,
  };
  localStorage.setItem(LS_PREFS, JSON.stringify(prefs));
}

/** Persist the open document paths + active doc so a relaunch can restore them. */
function persistSession(s: AppState) {
  const session = {
    paths: s.tabs.map((t) => t.doc.path),
    active: activeTab(s)?.doc.path ?? null,
  };
  try {
    localStorage.setItem(LS_SESSION, JSON.stringify(session));
  } catch {
    /* ignore */
  }
}

function loadSession(): { paths: string[]; active: string | null } {
  try {
    const raw = localStorage.getItem(LS_SESSION);
    if (raw) {
      const s = JSON.parse(raw);
      if (Array.isArray(s.paths)) return { paths: s.paths, active: s.active ?? null };
    }
  } catch {
    /* ignore */
  }
  return { paths: [], active: null };
}

const clampWidth = (w: number) => Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, w));
const clampContent = (w: number) =>
  Math.round(Math.min(CONTENT_MAX, Math.max(CONTENT_MIN, w)));

async function persistComments(doc: LoadedDocument, comments: Comment[]) {
  const file: CommentFile = { version: 2, document: doc.path, comments };
  try {
    await platform.saveComments(doc.path, JSON.stringify(file, null, 2));
  } catch (e) {
    console.error("Failed to persist comments", e);
  }
}

/** Shallow value-equality for a comment-change map (avoids needless renders). */
function changesEqual(
  a: Record<string, CommentChange>,
  b: Record<string, CommentChange>,
): boolean {
  const ak = Object.keys(a);
  if (ak.length !== Object.keys(b).length) return false;
  for (const k of ak) {
    const x = a[k];
    const y = b[k];
    if (!y || x.state !== y.state || x.wasText !== y.wasText || x.nowText !== y.nowText) {
      return false;
    }
  }
  return true;
}

/** Apply a patch to one tab by id. */
function patchTab(
  set: (fn: (s: AppState) => Partial<AppState>) => void,
  id: string,
  updater: (t: Tab) => Partial<Tab>,
) {
  set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, ...updater(t) } : t)) }));
}

export const useStore = create<AppState>((set, get) => ({
  tabs: [],
  activeTabId: null,
  ...loadPrefs(),
  showResolved: false,

  async loadDocument(doc, fragment) {
    // Re-opening an already-open document just activates its tab — but a link
    // that named a heading still has to take the reader there.
    const existing = get().tabs.find((t) => t.doc.path === doc.path);
    if (existing) {
      set({ activeTabId: existing.id });
      if (fragment) patchTab(set, existing.id, () => ({ pendingFragment: fragment }));
      persistSession(get());
      return;
    }
    const id = uid();
    const tab: Tab = {
      id,
      doc,
      comments: [],
      selectedId: null,
      changes: {},
      renderNonce: 0,
      pendingFragment: fragment ?? null,
    };
    set((s) => ({ tabs: [...s.tabs, tab], activeTabId: id }));
    persistSession(get());
    // Hydrate any saved comments for this document.
    try {
      const raw = await platform.loadComments(doc.path);
      if (raw) {
        const parsed = JSON.parse(raw) as CommentFile;
        if (Array.isArray(parsed.comments)) {
          patchTab(set, id, () => ({ comments: parsed.comments }));
        }
      }
    } catch (e) {
      console.error("Failed to load comments", e);
    }
  },

  clearPendingFragment(id) {
    if (get().tabs.some((t) => t.id === id && t.pendingFragment)) {
      patchTab(set, id, () => ({ pendingFragment: null }));
    }
  },

  async openDocument() {
    const doc = await platform.openDocument();
    if (doc) await get().loadDocument(doc);
  },

  async restoreSession() {
    if (!platform.isTauri()) return;
    const { paths, active } = loadSession();
    for (const p of paths) {
      const doc = await platform.readDocument(p).catch(() => null);
      if (doc) await get().loadDocument(doc);
    }
    if (active) {
      const t = get().tabs.find((tab) => tab.doc.path === active);
      if (t) set({ activeTabId: t.id });
    }
  },

  closeTab(id) {
    const { tabs, activeTabId } = get();
    const idx = tabs.findIndex((t) => t.id === id);
    if (idx === -1) return;
    const next = tabs.filter((t) => t.id !== id);
    let active = activeTabId;
    if (activeTabId === id) {
      active = next.length ? next[Math.min(idx, next.length - 1)].id : null;
    }
    set({ tabs: next, activeTabId: active });
    persistSession(get());
  },

  setActiveTab(id) {
    set({ activeTabId: id });
    persistSession(get());
  },

  reloadTabByPath(path, source) {
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.doc.path === path
          ? { ...t, doc: { ...t.doc, source }, renderNonce: t.renderNonce + 1 }
          : t,
      ),
    }));
  },

  addComment(anchor, body) {
    const tab = activeTab(get());
    if (!tab) return "";
    const id = uid();
    const now = new Date().toISOString();
    const { doc, comments } = tab;
    const color = HIGHLIGHT_COLORS[comments.length % HIGHLIGHT_COLORS.length];
    const baseline = {
      docHash: hashSource(doc.source),
      sourceText:
        anchor.sourceLineStart != null
          ? sliceSourceLines(doc.source, anchor.sourceLineStart, anchor.sourceLineEnd ?? anchor.sourceLineStart)
          : anchor.quote,
      lineStart: anchor.sourceLineStart,
      lineEnd: anchor.sourceLineEnd,
      capturedAt: now,
    };
    const comment: Comment = {
      id,
      documentPath: doc.path,
      createdAt: now,
      updatedAt: now,
      body,
      status: "open",
      color,
      anchor,
      baseline,
    };
    const next = [...comments, comment];
    patchTab(set, tab.id, () => ({ comments: next, selectedId: id }));
    persistComments(doc, next);
    return id;
  },

  importComments(list) {
    const tab = activeTab(get());
    if (!tab) return 0;
    const { doc, comments } = tab;
    const now = new Date().toISOString();
    const added: Comment[] = list.map((c, idx) => ({
      id: uid(),
      documentPath: doc.path,
      createdAt: now,
      updatedAt: now,
      body: c.body,
      status: c.status,
      color: c.color ?? HIGHLIGHT_COLORS[(comments.length + idx) % HIGHLIGHT_COLORS.length],
      anchor: c.anchor,
    }));
    const next = [...comments, ...added];
    patchTab(set, tab.id, () => ({ comments: next }));
    persistComments(doc, next);
    return added.length;
  },

  updateComment(id, patch) {
    const tab = activeTab(get());
    if (!tab) return;
    const next = tab.comments.map((c) =>
      c.id === id ? { ...c, ...patch, updatedAt: new Date().toISOString() } : c,
    );
    patchTab(set, tab.id, () => ({ comments: next }));
    persistComments(tab.doc, next);
  },

  resolveAsAddressed(id) {
    const tab = activeTab(get());
    if (!tab) return;
    const now = new Date().toISOString();
    const ch = tab.changes[id];
    const next = tab.comments.map((c) => {
      if (c.id !== id) return c;
      // Re-baseline to the current source so a reopened comment reads "untouched".
      const baseline = c.baseline
        ? {
            ...c.baseline,
            docHash: hashSource(tab.doc.source),
            sourceText: ch?.nowText ?? c.baseline.sourceText,
            capturedAt: now,
          }
        : c.baseline;
      return { ...c, status: "resolved" as const, baseline, updatedAt: now };
    });
    patchTab(set, tab.id, () => ({ comments: next }));
    persistComments(tab.doc, next);
  },

  deleteComment(id) {
    const tab = activeTab(get());
    if (!tab) return;
    const next = tab.comments.filter((c) => c.id !== id);
    patchTab(set, tab.id, (t) => ({
      comments: next,
      selectedId: t.selectedId === id ? null : t.selectedId,
    }));
    persistComments(tab.doc, next);
  },

  selectComment(id) {
    const tab = activeTab(get());
    if (!tab) return;
    patchTab(set, tab.id, () => ({ selectedId: id }));
  },

  setChanges(changes) {
    const tab = activeTab(get());
    if (!tab) return;
    // Bail when nothing changed so we don't allocate a new tabs array (which
    // would re-render App → DocumentView and risk a reclassify feedback loop).
    if (changesEqual(tab.changes, changes)) return;
    patchTab(set, tab.id, () => ({ changes }));
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
    set((s) => ({
      safeMode: !s.safeMode,
      // Re-render every open tab under the new mode.
      tabs: s.tabs.map((t) => ({ ...t, renderNonce: t.renderNonce + 1 })),
    }));
    savePrefs(get());
  },
  toggleShowResolved() {
    set((s) => ({ showResolved: !s.showResolved }));
  },
  setSidebarWidth(w) {
    set({ sidebarWidth: clampWidth(w) });
    savePrefs(get());
  },
  setContentWidth(w) {
    set({ contentWidth: clampContent(w) });
    savePrefs(get());
  },
  bumpRender() {
    const tab = activeTab(get());
    if (tab) patchTab(set, tab.id, (t) => ({ renderNonce: t.renderNonce + 1 }));
  },
}));

// Dev affordance: expose the store for debugging in the browser preview.
if (import.meta.env.DEV) {
  (window as unknown as { __store: typeof useStore }).__store = useStore;
}
