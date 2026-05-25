import { useCallback, useEffect, useRef, useState } from "react";
import { useStore, HIGHLIGHT_COLORS } from "../store/useStore";
import { captureAnchor, resolveRange, sourceLinesForRange } from "../lib/anchor";
import { hashSource, normalizeForCompare, sliceSourceLines } from "../lib/changes";
import type { Anchor, CommentChange } from "../types";
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
  const viewMode = useStore((s) => s.viewMode);
  const renderNonce = useStore((s) => s.renderNonce);
  const addComment = useStore((s) => s.addComment);
  const selectComment = useStore((s) => s.selectComment);
  const setChanges = useStore((s) => s.setChanges);

  const reading = viewMode === "reading";
  const rootRef = useRef<HTMLDivElement>(null);
  const [pending, setPending] = useState<PendingSelection | null>(null);

  // Paint highlights using the CSS Custom Highlight API (no DOM mutation).
  const paintHighlights = useCallback(() => {
    if (!supportsHighlights || !rootRef.current) return;
    // Reading mode is a plain reader: no annotations painted.
    if (reading) {
      CSS.highlights.clear();
      return;
    }
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
  }, [comments, selectedId, reading]);

  // Classify each comment against its baseline: untouched / edited / removed.
  const classify = useCallback(() => {
    const root = rootRef.current;
    if (!root || !doc) return;
    const source = doc.source;
    const curHash = hashSource(source);
    const map: Record<string, CommentChange> = {};
    for (const c of comments) {
      const b = c.baseline;
      if (!b) continue; // no baseline (e.g. imported) → no badge
      if (b.docHash === curHash) {
        map[c.id] = { state: "untouched" };
        continue;
      }
      const range = resolveRange(root, c.anchor);
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
      for (const c of comments) {
        const range = resolveRange(root, c.anchor);
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
          onRendered={() =>
            requestAnimationFrame(() => {
              paintHighlights();
              classify();
            })
          }
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
