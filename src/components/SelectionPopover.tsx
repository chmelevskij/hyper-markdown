import { useEffect, useRef, useState } from "react";

interface Props {
  /** Anchor rectangle (viewport coords) of the current selection. */
  rect: DOMRect;
  quote: string;
  onSubmit: (body: string) => void;
  onCancel: () => void;
}

export default function SelectionPopover({ rect, quote, onSubmit, onCancel }: Props) {
  const [body, setBody] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const top = Math.min(rect.bottom + 8, window.innerHeight - 200);
  const left = Math.min(Math.max(rect.left, 12), window.innerWidth - 340);

  return (
    <div
      ref={ref}
      className="sel-popover"
      style={{ top, left }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="sel-popover__quote">“{quote.slice(0, 120)}{quote.length > 120 ? "…" : ""}”</div>
      <textarea
        ref={textareaRef}
        className="sel-popover__input"
        placeholder="Comment for the agent…"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onSubmit(body);
          if (e.key === "Escape") onCancel();
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
