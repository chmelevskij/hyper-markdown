import { useCallback, useEffect, useRef, useState } from "react";
import { useStore, HIGHLIGHT_COLORS } from "../store/useStore";
import { captureAnchor, resolveRange } from "../lib/anchor";
import type { Anchor } from "../types";
import MdxRenderer from "./MdxRenderer";
import SelectionPopover from "./SelectionPopover";

interface PendingSelection {
  rect: DOMRect;
  anchor: Anchor;
}

const supportsHighlights = typeof CSS !== "undefined" && "highlights" in CSS;

export default function DocumentView() {
  const doc = useStore((s) => s.doc);
  const comments = useStore((s) => s.comments);
  const selectedId = useStore((s) => s.selectedId);
  const safeMode = useStore((s) => s.safeMode);
  const renderNonce = useStore((s) => s.renderNonce);
  const addComment = useStore((s) => s.addComment);
  const selectComment = useStore((s) => s.selectComment);

  const rootRef = useRef<HTMLDivElement>(null);
  const [pending, setPending] = useState<PendingSelection | null>(null);

  // Paint highlights using the CSS Custom Highlight API (no DOM mutation).
  const paintHighlights = useCallback(() => {
    if (!supportsHighlights || !rootRef.current) return;
    const root = rootRef.current;
    const buckets = HIGHLIGHT_COLORS.map(() => new Highlight());
    const active = new Highlight();
    for (const c of comments) {
      if (c.status === "resolved" && !useStore.getState().showResolved) continue;
      const range = resolveRange(root, c.anchor);
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
  }, [comments, selectedId]);

  useEffect(() => {
    paintHighlights();
  }, [paintHighlights, renderNonce]);

  useEffect(() => () => {
    if (supportsHighlights) CSS.highlights.clear();
  }, []);

  // Capture a selection inside the content into a pending comment.
  const onMouseUp = useCallback(() => {
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
  }, []);

  const onContentClick = useCallback(
    (e: React.MouseEvent) => {
      // Click on an existing highlight selects its comment.
      if (pending) return;
      const root = rootRef.current;
      if (!root) return;
      const caret =
        document.caretRangeFromPoint?.(e.clientX, e.clientY) ?? null;
      if (!caret) return;
      for (const c of comments) {
        const range = resolveRange(root, c.anchor);
        if (range && range.comparePoint(caret.startContainer, caret.startOffset) === 0) {
          selectComment(c.id);
          return;
        }
      }
    },
    [comments, pending, selectComment],
  );

  const commitComment = (body: string) => {
    if (pending) {
      addComment(pending.anchor, body.trim());
      window.getSelection()?.removeAllRanges();
      setPending(null);
      // Repaint after state settles.
      requestAnimationFrame(paintHighlights);
    }
  };

  if (!doc) return null;

  return (
    <div className="doc-scroll" onMouseDown={() => pending && setPending(null)}>
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
          onRendered={() => requestAnimationFrame(paintHighlights)}
        />
      </article>
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
