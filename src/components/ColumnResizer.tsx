import { useCallback, useEffect, useRef, useState } from "react";
import { CONTENT_DEFAULT, useStore } from "../store/useStore";

interface Box {
  top: number;
  height: number;
  left: number;
  right: number;
  center: number;
}

/**
 * Drag handles on both edges of the text column.
 *
 * The column is centred, so a drag on either edge resizes symmetrically: the
 * new max-width is twice the cursor's distance from the column's centre line.
 * Handles are `position: fixed` and measured from the scroll container, which
 * keeps them still while the document scrolls underneath and avoids adding any
 * scrollable overflow of their own.
 */
export default function ColumnResizer({
  scrollRef,
}: {
  scrollRef: React.RefObject<HTMLDivElement | null>;
}) {
  const width = useStore((s) => s.contentWidth);
  const setContentWidth = useStore((s) => s.setContentWidth);
  const [box, setBox] = useState<Box | null>(null);
  const [dragging, setDragging] = useState(false);
  const boxRef = useRef<Box | null>(null);
  boxRef.current = box;

  // Track the scroll container's geometry. A ResizeObserver covers the cases
  // that actually move the column: window resize, sidebar drag, tab bar
  // appearing/disappearing.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setBox({ top: r.top, height: r.height, left: r.left, right: r.right, center: r.left + r.width / 2 });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [scrollRef]);

  const startDrag = useCallback(
    (side: 1 | -1) => (e: React.MouseEvent) => {
      e.preventDefault();
      setDragging(true);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      const onMove = (ev: MouseEvent) => {
        const b = boxRef.current;
        if (!b) return;
        setContentWidth(2 * side * (ev.clientX - b.center));
      };
      const onUp = () => {
        setDragging(false);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [setContentWidth],
  );

  if (!box) return null;

  // Pin the handles to the visible column edge: once the pref exceeds the
  // available space the column stops growing, and the handle should follow it.
  const half = Math.min(width, box.right - box.left) / 2;
  const sides: Array<{ side: 1 | -1; x: number }> = [
    { side: -1, x: Math.max(box.left + 3, box.center - half) },
    { side: 1, x: Math.min(box.right - 3, box.center + half) },
  ];

  return (
    <>
      {sides.map(({ side, x }) => (
        <div
          key={side}
          className={`col-resizer ${dragging ? "is-dragging" : ""}`}
          style={{ top: box.top, height: box.height, left: x }}
          role="separator"
          aria-orientation="vertical"
          aria-label="Text column width"
          title="Drag to resize the text column · double-click to reset"
          onMouseDown={startDrag(side)}
          onDoubleClick={() => setContentWidth(CONTENT_DEFAULT)}
        />
      ))}
      {dragging && (
        <div className="col-resizer__readout" style={{ top: box.top + 12, left: box.center }}>
          {width}px
        </div>
      )}
    </>
  );
}
