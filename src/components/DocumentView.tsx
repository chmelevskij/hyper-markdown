import { useCallback, useEffect, useRef, useState } from "react";
import { useStore, HIGHLIGHT_COLORS, activeTab, activeComments } from "../store/useStore";
import { captureAnchor, createResolver, resolveRange, sourceLinesForRange } from "../lib/anchor";
import { hashSource, normalizeForCompare, sliceSourceLines } from "../lib/changes";
import { isMarkdownPath, type ResolvedTarget } from "../lib/links";
import { platform } from "../platform";
import type { Anchor, CommentChange } from "../types";
import MdxRenderer from "./MdxRenderer";
import SelectionPopover from "./SelectionPopover";

interface PendingSelection {
  rect: DOMRect;
  anchor: Anchor;
}

const supportsHighlights = typeof CSS !== "undefined" && "highlights" in CSS;

export default function DocumentView() {
  const doc = useStore((s) => activeTab(s)?.doc ?? null);
  const comments = useStore(activeComments);
  const selectedId = useStore((s) => activeTab(s)?.selectedId ?? null);
  const safeMode = useStore((s) => s.safeMode);
  const viewMode = useStore((s) => s.viewMode);
  const renderNonce = useStore((s) => activeTab(s)?.renderNonce ?? 0);
  const addComment = useStore((s) => s.addComment);
  const selectComment = useStore((s) => s.selectComment);
  const setChanges = useStore((s) => s.setChanges);
  const loadDocument = useStore((s) => s.loadDocument);

  const reading = viewMode === "reading";
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [pending, setPending] = useState<PendingSelection | null>(null);
  const [hoveredLink, setHoveredLink] = useState<string | null>(null);

  // Paint highlights using the CSS Custom Highlight API (no DOM mutation).
  const paintHighlights = useCallback(() => {
    if (!supportsHighlights || !rootRef.current) return;
    // Reading mode is a plain reader: no annotations painted.
    if (reading) {
      CSS.highlights.clear();
      return;
    }
    const root = rootRef.current;
    const resolve = createResolver(root);
    const buckets = HIGHLIGHT_COLORS.map(() => new Highlight());
    const active = new Highlight();
    for (const c of comments) {
      if (c.status === "resolved" && !useStore.getState().showResolved) continue;
      const range = resolve(c.anchor);
      if (!range) continue;
      if (c.id === selectedId) {
        active.add(range);
      } else {
        const idx = Math.max(0, HIGHLIGHT_COLORS.indexOf(c.color));
        buckets[idx].add(range);
      }
    }
    buckets.forEach((h, i) => CSS.highlights.set(`hmd-${i}`, h));
    CSS.highlights.set("hmd-active", active);
  }, [comments, selectedId, reading]);

  // Classify each comment against its baseline: untouched / edited / removed.
  const classify = useCallback(() => {
    const root = rootRef.current;
    if (!root || !doc) return;
    const source = doc.source;
    const curHash = hashSource(source);
    const resolve = createResolver(root);
    const map: Record<string, CommentChange> = {};
    for (const c of comments) {
      const b = c.baseline;
      if (!b) continue; // no baseline (e.g. imported) → no badge
      if (b.docHash === curHash) {
        map[c.id] = { state: "untouched" };
        continue;
      }
      const range = resolve(c.anchor);
      if (!range) {
        map[c.id] =
          b.sourceText && source.includes(b.sourceText)
            ? { state: "untouched" }
            : { state: "removed", wasText: b.sourceText };
        continue;
      }
      const { start, end } = sourceLinesForRange(range);
      const nowText =
        start != null ? sliceSourceLines(source, start, end ?? start) : range.toString();
      const wasText = b.sourceText ?? "";
      map[c.id] =
        normalizeForCompare(nowText) === normalizeForCompare(wasText)
          ? { state: "untouched" }
          : { state: "edited", wasText, nowText };
    }
    setChanges(map);
  }, [comments, doc, setChanges]);

  useEffect(() => {
    paintHighlights();
    classify();
  }, [paintHighlights, classify, renderNonce]);

  // Re-resolve highlights whenever the rendered content mutates. Async renders
  // (Shiki syntax highlighting, Mermaid diagrams) replace their nodes *after*
  // the initial commit — which collapses any live highlight Range captured
  // beforehand, so the annotation has to be re-resolved against the new DOM.
  const repaintRef = useRef<() => void>(() => {});
  repaintRef.current = () => {
    paintHighlights();
    classify();
  };
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let raf = 0;
    const observer = new MutationObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => repaintRef.current());
    });
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    return () => {
      observer.disconnect();
      cancelAnimationFrame(raf);
    };
  }, []);

  // Scroll the selected comment's anchor into view (e.g. clicked in the sidebar).
  // Skips when the anchor is already fully visible to avoid jarring jumps —
  // notably when the selection originated from clicking the highlight itself.
  useEffect(() => {
    if (!selectedId) return;
    const root = rootRef.current;
    const scroller = scrollRef.current;
    if (!root || !scroller) return;
    const comment = comments.find((c) => c.id === selectedId);
    if (!comment) return;
    const range = resolveRange(root, comment.anchor);
    if (!range) return;
    const rect = range.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;
    const view = scroller.getBoundingClientRect();
    if (rect.top >= view.top && rect.bottom <= view.bottom) return;
    const target =
      scroller.scrollTop + (rect.top - view.top) - view.height / 2 + rect.height / 2;
    scroller.scrollTo({ top: Math.max(0, target), behavior: "smooth" });
  }, [selectedId, comments, renderNonce]);

  useEffect(() => () => {
    if (supportsHighlights) CSS.highlights.clear();
  }, []);

  // Capture a selection inside the content into a pending comment.
  const onMouseUp = useCallback(() => {
    if (reading) return;
    const sel = window.getSelection();
    const root = rootRef.current;
    if (!sel || sel.isCollapsed || sel.rangeCount === 0 || !root) {
      return;
    }
    const range = sel.getRangeAt(0);
    if (!root.contains(range.commonAncestorContainer)) return;
    // Skip selections inside non-selectable regions (diagrams, errors).
    const container =
      range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
        ? (range.commonAncestorContainer as Element)
        : range.commonAncestorContainer.parentElement;
    if (container?.closest("[data-no-select]")) return;
    const text = sel.toString().trim();
    if (!text) return;
    const rect = range.getBoundingClientRect();
    setPending({ rect, anchor: captureAnchor(root, range) });
  }, [reading]);

  const onContentClick = useCallback(
    (e: React.MouseEvent) => {
      // Click on an existing highlight selects its comment.
      if (reading || pending) return;
      const root = rootRef.current;
      if (!root) return;
      const caret =
        document.caretRangeFromPoint?.(e.clientX, e.clientY) ?? null;
      if (!caret) return;
      const resolve = createResolver(root);
      for (const c of comments) {
        const range = resolve(c.anchor);
        if (range && range.comparePoint(caret.startContainer, caret.startOffset) === 0) {
          selectComment(c.id);
          return;
        }
      }
    },
    [comments, pending, reading, selectComment],
  );

  const commitComment = (body: string) => {
    if (pending) {
      addComment(pending.anchor, body.trim());
      window.getSelection()?.removeAllRanges();
      setPending(null);
      // Repaint + reclassify after state settles.
      requestAnimationFrame(() => {
        paintHighlights();
        classify();
      });
    }
  };

  // Stable so MdxRenderer's commit effect only fires when the content actually
  // changes. An inline arrow here would change identity on every render and,
  // because classify() writes a fresh `changes` map (new tabs array → App
  // re-render → DocumentView re-render), spin a 60fps render loop.
  const handleRendered = useCallback(() => {
    requestAnimationFrame(() => {
      paintHighlights();
      classify();
    });
  }, [paintHighlights, classify]);

  // Open a relative/absolute link target. Markdown files open as a new tab;
  // a same-document fragment scrolls in place; anything else is handed off to
  // the OS default handler so images, PDFs, etc. still open from a click.
  const handleOpenTarget = useCallback(
    async (target: ResolvedTarget) => {
      const docPath = doc?.path;
      if (!docPath) return;
      if (target.path === docPath && target.fragment) {
        const el = document.getElementById(decodeURIComponent(target.fragment));
        el?.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
      if (isMarkdownPath(target.path)) {
        const opened = await platform.readDocument(target.path).catch(() => null);
        if (opened) {
          await loadDocument(opened);
          return;
        }
      }
      if (platform.isTauri()) {
        const url = target.path.startsWith("file://") ? target.path : `file://${target.path}`;
        import("@tauri-apps/plugin-opener").then((m) => m.openUrl(url)).catch(() => {});
      }
    },
    [doc?.path, loadDocument],
  );

  if (!doc) return null;

  return (
    <div
      ref={scrollRef}
      className="doc-scroll"
      onMouseDown={() => pending && setPending(null)}
    >
      <article
        ref={rootRef}
        className="markdown-body"
        onMouseUp={onMouseUp}
        onClick={onContentClick}
      >
        <MdxRenderer
          source={doc.source}
          format={safeMode ? "md" : doc.format}
          nonce={renderNonce}
          docPath={doc.path}
          onOpenTarget={handleOpenTarget}
          onHoverTarget={setHoveredLink}
          onRendered={handleRendered}
        />
      </article>
      {hoveredLink && <div className="link-preview">{hoveredLink}</div>}
      {pending && (
        <SelectionPopover
          rect={pending.rect}
          quote={pending.anchor.quote}
          onSubmit={commitComment}
          onCancel={() => {
            setPending(null);
            window.getSelection()?.removeAllRanges();
          }}
        />
      )}
    </div>
  );
}
