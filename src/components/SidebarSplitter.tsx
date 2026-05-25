import { useCallback, useRef } from "react";
import { useStore } from "../store/useStore";

/** Drag handle on the sidebar's left edge to resize it. */
export default function SidebarSplitter() {
  const setSidebarWidth = useStore((s) => s.setSidebarWidth);
  const dragging = useRef(false);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragging.current = true;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      const onMove = (ev: MouseEvent) => {
        if (!dragging.current) return;
        // Sidebar is docked right: width grows as the cursor moves left.
        setSidebarWidth(window.innerWidth - ev.clientX);
      };
      const onUp = () => {
        dragging.current = false;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [setSidebarWidth],
  );

  return (
    <div
      className="splitter"
      role="separator"
      aria-orientation="vertical"
      onMouseDown={onMouseDown}
      title="Drag to resize"
    />
  );
}
