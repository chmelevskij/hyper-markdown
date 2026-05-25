import { useStore } from "../store/useStore";
import { platform } from "../platform";

const SAMPLE = `---
title: Architecture Notes
---

# Architecture Notes

Welcome to **hyper-markdown** — render Markdown/MDX, then _highlight any passage_
and attach a comment to feed back to your AI agent.

> Select this sentence and press "Add comment" to try it.

## Data flow

\`\`\`mermaid
flowchart LR
  Doc[Markdown / MDX] --> Render[Render pipeline]
  Render --> View[Themed HTML]
  View --> Highlight[Highlight + comment]
  Highlight --> Export[Export for agent]
\`\`\`

## A code sample

\`\`\`ts
export function greet(name: string): string {
  return \`Hello, \${name}!\`;
}
\`\`\`

## Checklist

- [x] Render Markdown
- [x] Mermaid diagrams
- [ ] Wire up your agent

Inline math like $E = mc^2$ also renders.
`;

export default function EmptyState() {
  const openDocument = useStore((s) => s.openDocument);
  const loadDocument = useStore((s) => s.loadDocument);

  return (
    <div className="empty">
      <div className="empty__card">
        <h1>◆ hyper-markdown</h1>
        <p>Render Markdown &amp; MDX, highlight passages, and export comments for your AI agent.</p>
        <div className="empty__actions">
          <button className="btn btn--primary" onClick={openDocument}>
            Open a file…
          </button>
          <button
            className="btn btn--ghost"
            onClick={() =>
              loadDocument({ path: "sample.mdx", name: "sample.mdx", source: SAMPLE, format: "mdx" })
            }
          >
            Load sample
          </button>
        </div>
        <p className="empty__hint">
          …or drag a <code>.md</code> / <code>.mdx</code> file anywhere onto this window.
          {platform.isTauri() ? "" : " (Running in browser preview mode.)"}
        </p>
      </div>
    </div>
  );
}
