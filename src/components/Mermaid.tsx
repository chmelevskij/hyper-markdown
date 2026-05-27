import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useStore } from "../store/useStore";
import { uid } from "../lib/id";

let initialized = false;
async function ensureMermaid(mode: "light" | "dark") {
  const mermaid = (await import("mermaid")).default;
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: mode === "dark" ? "dark" : "default",
  });
  initialized = true;
  return mermaid;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const MIN_SCALE = 0.2;
const MAX_SCALE = 8;

/** Fullscreen pan/zoom viewer for a rendered diagram. */
function MermaidViewer({ svg, onClose }: { svg: string; onClose: () => void }) {
  const stageRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const [scale, setScale] = useState(1);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const fitRef = useRef(1);

  // Open at a fit-to-stage scale so the diagram fills the screen instead of
  // showing at its (often tiny) natural size — that's the whole point of expanding.
  useLayoutEffect(() => {
    const stage = stageRef.current;
    const content = contentRef.current;
    if (!stage || !content) return;
    const sr = stage.getBoundingClientRect();
    const cr = content.getBoundingClientRect(); // measured at scale 1
    if (cr.width === 0 || cr.height === 0) return;
    const fit = clamp(
      Math.min((sr.width * 0.92) / cr.width, (sr.height * 0.92) / cr.height),
      MIN_SCALE,
      MAX_SCALE,
    );
    fitRef.current = fit;
    setScale(fit);
  }, [svg]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const reset = () => {
    setScale(fitRef.current);
    setTx(0);
    setTy(0);
  };

  // Zoom toward the cursor so the point under it stays put.
  const onWheel = (e: React.WheelEvent) => {
    const stage = stageRef.current;
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    const px = e.clientX - rect.left - rect.width / 2;
    const py = e.clientY - rect.top - rect.height / 2;
    const next = clamp(scale * (e.deltaY < 0 ? 1.1 : 1 / 1.1), MIN_SCALE, MAX_SCALE);
    const k = next / scale;
    setTx(px - (px - tx) * k);
    setTy(py - (py - ty) * k);
    setScale(next);
  };

  const zoomBy = (factor: number) => setScale((s) => clamp(s * factor, MIN_SCALE, MAX_SCALE));

  const onPointerDown = (e: React.PointerEvent) => {
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY, tx, ty };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    setTx(d.tx + (e.clientX - d.x));
    setTy(d.ty + (e.clientY - d.y));
  };
  const onPointerUp = () => {
    dragRef.current = null;
  };

  return createPortal(
    <div className="mermaid-viewer" onClick={onClose} data-no-select>
      <div className="mermaid-viewer__bar" onClick={(e) => e.stopPropagation()}>
        <button className="btn btn--ghost" onClick={() => zoomBy(1.2)} title="Zoom in">+</button>
        <button className="btn btn--ghost" onClick={() => zoomBy(1 / 1.2)} title="Zoom out">−</button>
        <button className="btn btn--ghost" onClick={reset} title="Reset">Reset</button>
        <button className="btn btn--primary" onClick={onClose} title="Close (Esc)">Close</button>
      </div>
      <div
        ref={stageRef}
        className="mermaid-viewer__stage"
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          ref={contentRef}
          className="mermaid-viewer__content"
          style={{ transform: `translate(${tx}px, ${ty}px) scale(${scale})` }}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </div>
    </div>,
    document.body,
  );
}

/** Renders a ```mermaid fenced block to inline SVG, theme-aware, with error fallback. */
export default function Mermaid({ code }: { code: string }) {
  const mode = useStore((s) => s.mode);
  const [svg, setSvg] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const idRef = useRef(`mmd-${uid().slice(0, 8)}`);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    (async () => {
      try {
        const mermaid = await ensureMermaid(mode);
        if (!initialized) return;
        const { svg } = await mermaid.render(idRef.current, code);
        if (!cancelled) setSvg(svg);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code, mode]);

  if (error) {
    return (
      <div className="mermaid-error" data-no-select>
        <strong>Diagram error</strong>
        <pre>{error}</pre>
        <pre>{code}</pre>
      </div>
    );
  }
  if (!svg) return <div className="mermaid-loading" data-no-select>Rendering diagram…</div>;
  return (
    <div className="mermaid-figure" data-no-select>
      <button
        type="button"
        className="mermaid-expand"
        title="Expand diagram"
        onClick={() => setExpanded(true)}
      >
        ⤢
      </button>
      <div className="mermaid-figure__svg" dangerouslySetInnerHTML={{ __html: svg }} />
      {expanded && <MermaidViewer svg={svg} onClose={() => setExpanded(false)} />}
    </div>
  );
}
