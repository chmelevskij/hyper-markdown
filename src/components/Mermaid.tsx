import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { activeComments, activeTab, useStore } from "../store/useStore";
import { hashSource } from "../lib/changes";
import { LINE_KINDS, partAt, resolvePart } from "../lib/diagram";
import { uid } from "../lib/id";
import type { DiagramPart } from "../types";

let initialized = false;
async function ensureMermaid(mode: "light" | "dark") {
  const mermaid = (await import("mermaid")).default;
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: mode === "dark" ? "dark" : "neutral",
  });
  initialized = true;
  return mermaid;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const MIN_SCALE = 0.2;
const MAX_SCALE = 8;

/** Where a diagram part sits, in the stage's own (untransformed) coordinates. */
interface Geom {
  shape: "box" | "line";
  left: number;
  top: number;
  width: number;
  height: number;
  pinX: number;
  pinY: number;
}

interface Mark extends Geom {
  id: string;
  n: number;
  color: string;
  selected: boolean;
}

export interface PartPick {
  part: DiagramPart;
  rect: DOMRect;
  srcStart?: number;
  srcEnd?: number;
}

/**
 * The diagram part a comment is currently being written against.
 *
 * Deliberately a context rather than a prop: the MDX `components` map is rebuilt
 * whenever its inputs change, and a new `pre` function identity remounts every
 * code block and diagram in the document — which would tear down the very
 * diagram (and any open fullscreen viewer) the comment is being written on.
 */
export const PendingPartContext = createContext<DiagramPart | null>(null);

const BOX_PAD = 4;

/**
 * Measure an element relative to the stage. Everything is divided by `scale`
 * because the overlay lives *inside* the transformed content in the fullscreen
 * viewer — that way markers pan and zoom with the diagram for free.
 */
function geomOf(el: Element, host: HTMLElement, scale: number, kind: string): Geom | null {
  const r = el.getBoundingClientRect();
  const h = host.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  const left = (r.left - h.left) / scale;
  const top = (r.top - h.top) / scale;
  const width = r.width / scale;
  const height = r.height / scale;
  if (LINE_KINDS.has(kind)) {
    // A curved edge's bounding box says little; mark the stroke's midpoint.
    const geo = el as SVGGeometryElement;
    let pinX = left + width / 2;
    let pinY = top + height / 2;
    if (typeof geo.getTotalLength === "function") {
      const ctm = geo.getScreenCTM();
      if (ctm) {
        try {
          const p = geo.getPointAtLength(geo.getTotalLength() / 2);
          pinX = (ctm.a * p.x + ctm.c * p.y + ctm.e - h.left) / scale;
          pinY = (ctm.b * p.x + ctm.d * p.y + ctm.f - h.top) / scale;
        } catch {
          /* fall back to the bbox centre */
        }
      }
    }
    return { shape: "line", left, top, width, height, pinX, pinY };
  }
  return {
    shape: "box",
    left: left - BOX_PAD,
    top: top - BOX_PAD,
    width: width + BOX_PAD * 2,
    height: height + BOX_PAD * 2,
    pinX: left + width,
    pinY: top,
  };
}

/** Paint a stroked part by recolouring it — a tint over its bounding box would
 *  cover half the diagram. Returns a reset function. */
function paintStroke(el: Element, color: string, strong: boolean): () => void {
  const style = (el as SVGElement).style;
  const prev = { stroke: style.stroke, width: style.strokeWidth, opacity: style.strokeOpacity };
  style.stroke = color;
  style.strokeWidth = strong ? "4px" : "3px";
  style.strokeOpacity = "1";
  return () => {
    style.stroke = prev.stroke;
    style.strokeWidth = prev.width;
    style.strokeOpacity = prev.opacity;
  };
}

/**
 * A rendered diagram plus its annotation layer: hover targeting, click-to-comment
 * and a marker for every comment anchored into this block. Used both inline and
 * inside the fullscreen viewer.
 */
function DiagramStage({
  svg,
  block,
  srcStart,
  srcEnd,
  scale = 1,
  interactive,
  onPickPart,
  suppressClick,
}: {
  svg: string;
  block: string;
  srcStart?: number;
  srcEnd?: number;
  scale?: number;
  interactive: boolean;
  onPickPart?: (pick: PartPick) => void;
  suppressClick?: () => boolean;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const pendingPart = useContext(PendingPartContext);
  // Reading mode is a plain reader — same rule the text highlights follow.
  const annotate = useStore((s) => s.viewMode === "comment");
  const comments = useStore(activeComments);
  const showResolved = useStore((s) => s.showResolved);
  const selectedId = useStore((s) => activeTab(s)?.selectedId ?? null);
  const selectComment = useStore((s) => s.selectComment);
  const [marks, setMarks] = useState<Mark[]>([]);
  const [hover, setHover] = useState<(Geom & { label: string }) | null>(null);
  const strokeResets = useRef<Array<() => void>>([]);
  // Stable identity: React 19 re-writes innerHTML whenever this prop's object
  // changes, which would re-parse the SVG on every render and drop the inline
  // highlights we paint onto it.
  const html = useMemo(() => ({ __html: svg }), [svg]);

  // Comments that live in this diagram, carrying their 1-based sidebar position
  // so the pin numbers match the comment list.
  const mine = useMemo(
    () =>
      annotate
        ? comments
            .map((c, i) => ({ c, n: i + 1 }))
            .filter(
              ({ c }) =>
                c.anchor.part?.block === block && (showResolved || c.status === "open"),
            )
        : [],
    [annotate, comments, block, showResolved],
  );

  const measure = useCallback(() => {
    const host = hostRef.current;
    const svgEl = host?.querySelector("svg") as SVGSVGElement | null;
    strokeResets.current.forEach((reset) => reset());
    strokeResets.current = [];
    if (!host || !svgEl) {
      setMarks([]);
      return;
    }
    const next: Mark[] = [];
    for (const { c, n } of mine) {
      const part = c.anchor.part!;
      const el = resolvePart(svgEl, part);
      if (!el) continue;
      const geom = geomOf(el, host, scale, part.kind);
      if (!geom) continue;
      const selected = c.id === selectedId;
      if (geom.shape === "line") {
        strokeResets.current.push(paintStroke(el, c.color, selected));
      }
      next.push({ ...geom, id: c.id, n, color: c.color, selected });
    }
    setMarks(next);
  }, [mine, scale, selectedId]);

  useLayoutEffect(() => {
    measure();
  }, [measure, svg]);

  useEffect(() => () => strokeResets.current.forEach((reset) => reset()), []);

  // Re-measure when the diagram reflows (window resize, sidebar drag, fonts) or
  // when its SVG is swapped out from under us (a re-render of the same diagram).
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let raf = 0;
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => measure());
    };
    const ro = new ResizeObserver(schedule);
    ro.observe(host);
    const mo = new MutationObserver(schedule);
    mo.observe(host, { childList: true, subtree: true });
    return () => {
      ro.disconnect();
      mo.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [measure]);

  const hitAt = useCallback(
    (e: React.MouseEvent) => {
      const host = hostRef.current;
      const svgEl = host?.querySelector("svg") as SVGSVGElement | null;
      if (!host || !svgEl) return null;
      const hit = partAt(e.target as Element, svgEl, block, { x: e.clientX, y: e.clientY });
      if (!hit) return null;
      return { ...hit, host };
    },
    [block],
  );

  const onMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!interactive) return;
      const hit = hitAt(e);
      if (!hit) {
        setHover(null);
        return;
      }
      const geom = geomOf(hit.el, hit.host, scale, hit.part.kind);
      setHover(geom ? { ...geom, label: hit.part.label } : null);
    },
    [hitAt, interactive, scale],
  );

  const onClick = useCallback(
    (e: React.MouseEvent) => {
      if (!interactive || !onPickPart) return;
      if (suppressClick?.()) return;
      const hit = hitAt(e);
      if (!hit) return;
      // Stop the click here: it must not reach the document's comment hit-test
      // or the fullscreen viewer's close-on-backdrop handler.
      e.stopPropagation();
      const rect = LINE_KINDS.has(hit.part.kind)
        ? new DOMRect(e.clientX, e.clientY, 0, 0)
        : hit.el.getBoundingClientRect();
      onPickPart({ part: hit.part, rect, srcStart, srcEnd });
    },
    [hitAt, interactive, onPickPart, srcEnd, srcStart, suppressClick],
  );

  // Keep the part outlined while its comment is being written; a live hover wins.
  const pendingGeom = usePendingGeom(hostRef, svg, pendingPart, block, scale);
  const outline = hover ?? pendingGeom;

  return (
    <div
      ref={hostRef}
      className={`diagram-stage ${interactive ? "is-interactive" : ""} ${
        hover ? "is-targeting" : ""
      }`}
      onMouseMove={onMouseMove}
      onMouseLeave={() => setHover(null)}
      onClick={onClick}
    >
      <div className="diagram-stage__svg" dangerouslySetInnerHTML={html} />
      {outline && outline.shape === "box" && (
        <div
          className="part-outline"
          style={{
            left: outline.left,
            top: outline.top,
            width: outline.width,
            height: outline.height,
          }}
        />
      )}
      {outline && outline.shape === "line" && (
        <div
          className="part-outline part-outline--dot"
          style={{ left: outline.pinX, top: outline.pinY, transform: `translate(-50%, -50%) scale(${1 / scale})` }}
        />
      )}
      {marks.map((m) => (
        <div key={m.id} className="part-mark">
          {m.shape === "box" && (
            <div
              className={`part-mark__box ${m.selected ? "is-selected" : ""}`}
              style={{
                left: m.left,
                top: m.top,
                width: m.width,
                height: m.height,
                background: m.color,
                borderColor: m.color,
              }}
            />
          )}
          <button
            type="button"
            className={`part-mark__pin ${m.selected ? "is-selected" : ""}`}
            style={{
              left: m.pinX,
              top: m.pinY,
              background: m.color,
              transform: `translate(-50%, -50%) scale(${1 / scale})`,
            }}
            title="Show this comment"
            onClick={(e) => {
              e.stopPropagation();
              selectComment(m.id);
            }}
          >
            {m.n}
          </button>
        </div>
      ))}
    </div>
  );
}

/** Geometry of the part a not-yet-saved comment is being written against. */
function usePendingGeom(
  hostRef: React.RefObject<HTMLDivElement | null>,
  svg: string,
  part: DiagramPart | null | undefined,
  block: string,
  scale: number,
): (Geom & { label: string }) | null {
  const [geom, setGeom] = useState<(Geom & { label: string }) | null>(null);
  useLayoutEffect(() => {
    const host = hostRef.current;
    const svgEl = host?.querySelector("svg") as SVGSVGElement | null;
    if (!host || !svgEl || !part || part.block !== block) {
      setGeom(null);
      return;
    }
    const el = resolvePart(svgEl, part);
    const g = el ? geomOf(el, host, scale, part.kind) : null;
    setGeom(g ? { ...g, label: part.label } : null);
  }, [hostRef, svg, part, block, scale]);
  return geom;
}

/** Fullscreen pan/zoom viewer for a rendered diagram. */
function MermaidViewer({
  svg,
  block,
  srcStart,
  srcEnd,
  interactive,
  onPickPart,
  onClose,
}: {
  svg: string;
  block: string;
  srcStart?: number;
  srcEnd?: number;
  interactive: boolean;
  onPickPart?: (pick: PartPick) => void;
  onClose: () => void;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  /** True once the pointer has moved past a small threshold since pointerdown,
   *  so the trailing click after a pan-drag doesn't get treated as a backdrop tap. */
  const draggedRef = useRef(false);
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
    draggedRef.current = false;
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    if (
      !draggedRef.current &&
      (Math.abs(e.clientX - d.x) > 3 || Math.abs(e.clientY - d.y) > 3)
    ) {
      draggedRef.current = true;
    }
    setTx(d.tx + (e.clientX - d.x));
    setTy(d.ty + (e.clientY - d.y));
  };
  const onPointerUp = () => {
    dragRef.current = null;
  };

  // Let backdrop taps close the viewer. We only swallow the click when it was
  // really a drag, or when it landed on the diagram itself.
  const onStageClick = (e: React.MouseEvent) => {
    if (draggedRef.current) {
      e.stopPropagation();
      return;
    }
    if (contentRef.current?.contains(e.target as Node)) {
      e.stopPropagation();
    }
  };

  return createPortal(
    <div className="mermaid-viewer" onClick={onClose} data-no-select>
      <div className="mermaid-viewer__bar" onClick={(e) => e.stopPropagation()}>
        {interactive && (
          <span className="mermaid-viewer__hint">Click a part of the diagram to comment</span>
        )}
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
        onClick={onStageClick}
      >
        <div
          ref={contentRef}
          className="mermaid-viewer__content"
          style={{ transform: `translate(${tx}px, ${ty}px) scale(${scale})` }}
        >
          <DiagramStage
            svg={svg}
            block={block}
            srcStart={srcStart}
            srcEnd={srcEnd}
            scale={scale}
            interactive={interactive}
            onPickPart={onPickPart}
            suppressClick={() => draggedRef.current}
          />
        </div>
      </div>
    </div>,
    document.body,
  );
}

interface Props {
  code: string;
  /** Source line range of the fenced block, stamped by rehypeSourceLine. */
  srcStart?: number;
  srcEnd?: number;
  onPickPart?: (pick: PartPick) => void;
}

/** Renders a ```mermaid fenced block to inline SVG, theme-aware, with error fallback. */
export default function Mermaid({ code, srcStart, srcEnd, onPickPart }: Props) {
  const mode = useStore((s) => s.mode);
  const commenting = useStore((s) => s.viewMode === "comment");
  const [svg, setSvg] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const idRef = useRef(`mmd-${uid().slice(0, 8)}`);
  // Identity of this fenced block within the document — its start line where the
  // renderer stamped one, else a hash of the diagram source.
  const block = useMemo(
    () => (srcStart != null ? `L${srcStart}` : `H${hashSource(code)}`),
    [srcStart, code],
  );

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
  const interactive = commenting && !!onPickPart;
  return (
    <div
      className="mermaid-figure"
      data-no-select
      data-src-start={srcStart}
      data-src-end={srcEnd}
      data-mermaid-block={block}
    >
      <button
        type="button"
        className="mermaid-expand"
        title="Expand diagram"
        onClick={() => setExpanded(true)}
      >
        ⤢
      </button>
      <div className="mermaid-figure__svg">
        <DiagramStage
          svg={svg}
          block={block}
          srcStart={srcStart}
          srcEnd={srcEnd}
          interactive={interactive}
          onPickPart={onPickPart}
        />
      </div>
      {expanded && (
        <MermaidViewer
          svg={svg}
          block={block}
          srcStart={srcStart}
          srcEnd={srcEnd}
          interactive={interactive}
          onPickPart={onPickPart}
          onClose={() => setExpanded(false)}
        />
      )}
    </div>
  );
}
