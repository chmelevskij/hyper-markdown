import { useEffect, useRef, useState } from "react";
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

/** Renders a ```mermaid fenced block to inline SVG, theme-aware, with error fallback. */
export default function Mermaid({ code }: { code: string }) {
  const mode = useStore((s) => s.mode);
  const [svg, setSvg] = useState("");
  const [error, setError] = useState<string | null>(null);
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
  return <div className="mermaid-figure" data-no-select dangerouslySetInnerHTML={{ __html: svg }} />;
}
