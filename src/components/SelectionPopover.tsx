import { useCallback, useEffect, useRef, useState } from "react";
import { platform } from "../platform";

interface Props {
  /** Anchor rectangle (viewport coords) of the current selection. */
  rect: DOMRect;
  quote: string;
  /** Set when the target is a diagram part ("node", "edge", …) rather than text. */
  kind?: string;
  onSubmit: (body: string) => void;
  onCancel: () => void;
}

export default function SelectionPopover({ rect, quote, kind, onSubmit, onCancel }: Props) {
  const [body, setBody] = useState("");
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const copyQuote = useCallback(async () => {
    await platform.copyToClipboard(quote);
    setCopied(true);
  }, [quote]);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1400);
    return () => clearTimeout(t);
  }, [copied]);

  // ⌘C / Ctrl+C copies the selected passage. Focus lives in the note field
  // while the popover is open, so without this the native copy would target an
  // empty textarea — unless the user actually selected something inside it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "c") return;
      const ta = textareaRef.current;
      if (ta && document.activeElement === ta && ta.selectionStart !== ta.selectionEnd) return;
      e.preventDefault();
      copyQuote();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [copyQuote]);

  const top = Math.min(rect.bottom + 8, window.innerHeight - 200);
  const left = Math.min(Math.max(rect.left, 12), window.innerWidth - 340);

  return (
    <div
      ref={ref}
      className="sel-popover"
      style={{ top, left }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="sel-popover__quote-row">
        <div className="sel-popover__quote">
          {kind && <span className="sel-popover__kind">{kind}</span>}
          “{quote.slice(0, 120)}
          {quote.length > 120 ? "…" : ""}”
        </div>
        <button
          className="icon-btn sel-popover__copy"
          title="Copy selected text (⌘C)"
          aria-label="Copy selected text"
          onClick={copyQuote}
        >
          {copied ? "✓" : "⧉"}
        </button>
      </div>
      <textarea
        ref={textareaRef}
        className="sel-popover__input"
        placeholder="Comment for the agent…"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onSubmit(body);
          if (e.key === "Escape") {
            // Don't let Escape reach the fullscreen diagram viewer as well —
            // dismissing the note should not also throw away the zoomed view.
            e.stopPropagation();
            onCancel();
          }
        }}
      />
      <div className="sel-popover__actions">
        <button className="btn btn--ghost" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn btn--primary" onClick={() => onSubmit(body)}>
          Add comment <span className="kbd">⌘⏎</span>
        </button>
      </div>
    </div>
  );
}
