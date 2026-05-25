import { useEffect, useState } from "react";
import { useStore } from "../store/useStore";
import { highlightCode } from "../lib/highlight";

interface Props {
  code: string;
  lang?: string;
  /** Source-line data attributes forwarded from the original <pre>. */
  dataSrcStart?: number;
  dataSrcEnd?: number;
}

/** A fenced code block, syntax-highlighted with Shiki (async, theme-aware). */
export default function CodeBlock({ code, lang, dataSrcStart, dataSrcEnd }: Props) {
  const mode = useStore((s) => s.mode);
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    highlightCode(code, lang, mode)
      .then((h) => !cancelled && setHtml(h))
      .catch(() => !cancelled && setHtml(null));
    return () => {
      cancelled = true;
    };
  }, [code, lang, mode]);

  const lineAttrs = { "data-src-start": dataSrcStart, "data-src-end": dataSrcEnd };

  if (html) {
    return (
      <div
        className="code-block"
        {...lineAttrs}
        data-lang={lang}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }
  return (
    <pre className="code-block code-block--plain" {...lineAttrs} data-lang={lang}>
      <code>{code}</code>
    </pre>
  );
}
