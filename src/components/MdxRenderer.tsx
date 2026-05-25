import { isValidElement, useEffect, useMemo, useState, type ReactNode } from "react";
import type { MDXComponents } from "mdx/types";
import { compileDocument, type MDXContent } from "../lib/render";
import { platform } from "../platform";
import CodeBlock from "./CodeBlock";
import Mermaid from "./Mermaid";

function nodeToText(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeToText).join("");
  if (isValidElement(node)) return nodeToText((node.props as { children?: ReactNode }).children);
  return "";
}

const components: MDXComponents = {
  pre(props: Record<string, unknown>) {
    const child = props.children as ReactNode;
    if (isValidElement(child)) {
      const codeProps = child.props as { className?: string; children?: ReactNode };
      const className = codeProps.className ?? "";
      const lang = /language-([\w-]+)/.exec(className)?.[1];
      const code = nodeToText(codeProps.children).replace(/\n$/, "");
      const dataSrcStart = props["data-src-start"] as number | undefined;
      const dataSrcEnd = props["data-src-end"] as number | undefined;
      if (lang === "mermaid") return <Mermaid code={code} />;
      return <CodeBlock code={code} lang={lang} dataSrcStart={dataSrcStart} dataSrcEnd={dataSrcEnd} />;
    }
    return <pre {...(props as object)} />;
  },
  a(props: Record<string, unknown>) {
    const href = props.href as string | undefined;
    const isExternal = !!href && /^https?:\/\//.test(href);
    return (
      <a
        {...(props as object)}
        target={isExternal ? "_blank" : undefined}
        rel={isExternal ? "noreferrer" : undefined}
        onClick={(e) => {
          if (isExternal && platform.isTauri()) {
            e.preventDefault();
            import("@tauri-apps/plugin-opener").then((m) => m.openUrl(href!)).catch(() => {});
          }
        }}
      />
    );
  },
};

interface Props {
  source: string;
  format: "md" | "mdx";
  /** Bumped externally to force a recompile (theme/safe-mode independent of source). */
  nonce: number;
  onRendered?: () => void;
}

export default function MdxRenderer({ source, format, nonce, onRendered }: Props) {
  const [Content, setContent] = useState<MDXContent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = useMemo(() => `${nonce}:${format}`, [nonce, format]);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    compileDocument(source, { format })
      .then((C) => {
        if (!cancelled) setContent(() => C);
      })
      .catch((e) => {
        if (!cancelled) {
          setContent(null);
          setError(e instanceof Error ? e.message : String(e));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [source, key, format]);

  // Notify after content commits so the annotation layer can resolve highlights.
  useEffect(() => {
    if (Content) onRendered?.();
  }, [Content, onRendered]);

  if (error) {
    return (
      <div className="render-error">
        <strong>Could not render this document</strong>
        <pre>{error}</pre>
        {format === "mdx" && (
          <p className="render-error__hint">
            This is parsed as MDX (JSX + expressions). Try Safe Mode to render it as plain
            Markdown.
          </p>
        )}
      </div>
    );
  }
  if (!Content) return <div className="render-loading">Rendering…</div>;
  return <Content components={components} />;
}
