import { useState } from "react";
import { useStore, activeTab, activeComments, activeChanges } from "../store/useStore";
import { platform } from "../platform";
import { toJSON, toMarkdown } from "../lib/export";
import { parseImport } from "../lib/importComments";
import type { Comment, CommentChange } from "../types";
import PullRequestPanel from "./PullRequestPanel";

const CHANGE_LABEL: Record<CommentChange["state"], string> = {
  untouched: "untouched",
  edited: "edited",
  removed: "removed",
};

function CommentCard({
  comment,
  change,
  n,
}: {
  comment: Comment;
  change?: CommentChange;
  /** Position in the document's comment list — matches the pin drawn on a diagram. */
  n: number;
}) {
  const selectedId = useStore((s) => activeTab(s)?.selectedId ?? null);
  const selectComment = useStore((s) => s.selectComment);
  const updateComment = useStore((s) => s.updateComment);
  const resolveAsAddressed = useStore((s) => s.resolveAsAddressed);
  const deleteComment = useStore((s) => s.deleteComment);
  const [editing, setEditing] = useState(comment.body === "");
  const [draft, setDraft] = useState(comment.body);

  const selected = selectedId === comment.id;
  const lines = comment.anchor.sourceLineStart;
  const lineLabel =
    lines == null
      ? null
      : comment.anchor.sourceLineEnd && comment.anchor.sourceLineEnd !== lines
        ? `L${lines}–${comment.anchor.sourceLineEnd}`
        : `L${lines}`;

  const state = change?.state;
  const needsReview = comment.status === "open" && (state === "edited" || state === "removed");

  return (
    <div
      className={`comment-card ${selected ? "is-selected" : ""} ${
        comment.status === "resolved" ? "is-resolved" : ""
      }`}
      onClick={() => selectComment(comment.id)}
    >
      <div className="comment-card__head">
        {comment.anchor.part ? (
          <span className="comment-card__pin" style={{ background: comment.color }}>
            {n}
          </span>
        ) : (
          <span className="comment-card__swatch" style={{ background: comment.color }} />
        )}
        {lineLabel && <span className="comment-card__lines">{lineLabel}</span>}
        {comment.anchor.part && (
          <span className="comment-card__part">{comment.anchor.part.kind}</span>
        )}
        {state && (
          <span className={`change-badge change-badge--${state}`}>{CHANGE_LABEL[state]}</span>
        )}
        {comment.github && (
          <a
            className="comment-card__gh"
            href={comment.github.url}
            title={`On GitHub · @${comment.github.author}${comment.github.remoteResolved ? " · resolved" : ""}`}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              platform.openExternal(comment.github!.url);
            }}
          >
            ⎇ @{comment.github.author}
          </a>
        )}
        <div className="comment-card__actions">
          <button
            className="icon-btn"
            title={comment.status === "open" ? "Resolve" : "Reopen"}
            onClick={(e) => {
              e.stopPropagation();
              updateComment(comment.id, {
                status: comment.status === "open" ? "resolved" : "open",
              });
            }}
          >
            {comment.status === "open" ? "✓" : "↺"}
          </button>
          <button
            className="icon-btn"
            title="Delete"
            onClick={(e) => {
              e.stopPropagation();
              deleteComment(comment.id);
            }}
          >
            ✕
          </button>
        </div>
      </div>
      <blockquote className="comment-card__quote">{comment.anchor.quote}</blockquote>
      {editing ? (
        <textarea
          className="comment-card__editor"
          autoFocus
          value={draft}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            updateComment(comment.id, { body: draft.trim() });
            setEditing(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              updateComment(comment.id, { body: draft.trim() });
              setEditing(false);
            }
          }}
        />
      ) : (
        <p
          className="comment-card__body"
          onClick={(e) => {
            e.stopPropagation();
            setEditing(true);
          }}
        >
          {comment.body || <span className="comment-card__placeholder">Add a note…</span>}
        </p>
      )}

      {needsReview && (
        <div className="change-diff" onClick={(e) => e.stopPropagation()}>
          {state === "edited" ? (
            <>
              <span className="change-diff__label">was</span>
              <pre className="change-diff__was">{change?.wasText}</pre>
              <span className="change-diff__label">now</span>
              <pre className="change-diff__now">{change?.nowText}</pre>
            </>
          ) : (
            <>
              <span className="change-diff__label">removed from document</span>
              <pre className="change-diff__was">{change?.wasText}</pre>
            </>
          )}
          <button
            className="btn btn--primary change-diff__resolve"
            onClick={() => resolveAsAddressed(comment.id)}
          >
            Resolve as addressed
          </button>
        </div>
      )}
    </div>
  );
}

type Filter = "all" | "review";

export default function CommentSidebar({ width }: { width: number }) {
  const doc = useStore((s) => activeTab(s)?.doc ?? null);
  const comments = useStore(activeComments);
  const changes = useStore(activeChanges);
  const showResolved = useStore((s) => s.showResolved);
  const toggleShowResolved = useStore((s) => s.toggleShowResolved);
  const setViewMode = useStore((s) => s.setViewMode);
  const importComments = useStore((s) => s.importComments);
  const [toast, setToast] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");

  const needsReview = (c: Comment) => {
    const s = changes[c.id]?.state;
    return c.status === "open" && (s === "edited" || s === "removed");
  };

  const openCount = comments.filter((c) => c.status === "open").length;
  const reviewCount = comments.filter(needsReview).length;

  const visible = comments.filter((c) => {
    if (!showResolved && c.status !== "open") return false;
    if (filter === "review") return needsReview(c);
    return true;
  });

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 1800);
  };

  const copyMarkdown = async () => {
    await platform.copyToClipboard(toMarkdown(doc?.name ?? "document", comments, { includeResolved: showResolved }));
    flash("Markdown copied for agent");
  };
  const copyJSON = async () => {
    await platform.copyToClipboard(toJSON(doc?.name ?? "document", comments, { includeResolved: showResolved }));
    flash("JSON copied");
  };
  const writeFile = async () => {
    const base = (doc?.name ?? "document").replace(/\.(md|mdx|markdown)$/i, "");
    const target = await platform.writeExport(
      `${base}.comments.md`,
      toMarkdown(doc?.name ?? "document", comments, { includeResolved: showResolved }),
    );
    if (target) flash(`Saved ${target.split(/[\\/]/).pop()}`);
  };
  const importFile = async () => {
    const picked = await platform.importTextFile();
    if (!picked) return;
    try {
      const parsed = parseImport(picked.text, picked.name);
      if (parsed.length === 0) {
        flash("No comments found in file");
        return;
      }
      const n = importComments(parsed);
      flash(`Imported ${n} comment${n === 1 ? "" : "s"}`);
    } catch (e) {
      flash(`Import failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <aside className="sidebar" style={{ flexBasis: width, width }}>
      <div className="sidebar__head">
        <h2>Comments</h2>
        <span className="sidebar__count">
          {openCount} open{reviewCount > 0 ? ` · ${reviewCount} to review` : ""}
        </span>
        <button
          className="icon-btn sidebar__collapse"
          onClick={() => setViewMode("reading")}
          title="Switch to reading mode"
        >
          ⇥
        </button>
      </div>

      <div className="sidebar__export">
        <div className="sidebar__filter">
          <button
            className={`seg__btn ${filter === "all" ? "is-active" : ""}`}
            onClick={() => setFilter("all")}
          >
            All
          </button>
          <button
            className={`seg__btn ${filter === "review" ? "is-active" : ""}`}
            onClick={() => setFilter("review")}
          >
            Needs review{reviewCount > 0 ? ` (${reviewCount})` : ""}
          </button>
        </div>
        <button className="btn btn--primary" disabled={!comments.length} onClick={copyMarkdown}>
          Copy for agent
        </button>
        <div className="sidebar__export-row">
          <button className="btn btn--ghost" disabled={!comments.length} onClick={writeFile}>
            Save .md
          </button>
          <button className="btn btn--ghost" disabled={!comments.length} onClick={copyJSON}>
            Copy JSON
          </button>
        </div>
        <button className="btn btn--ghost" onClick={importFile}>
          Import comments…
        </button>
        <PullRequestPanel flash={flash} />
        <label className="sidebar__toggle">
          <input type="checkbox" checked={showResolved} onChange={toggleShowResolved} />
          Show resolved
        </label>
      </div>

      <div className="sidebar__list">
        {visible.length === 0 ? (
          <p className="sidebar__empty">
            {filter === "review"
              ? "No comments need review — nothing changed under your open comments."
              : "Select text in the document to attach a comment. Each comment carries the quoted source and its line numbers for the agent."}
          </p>
        ) : (
          visible.map((c) => (
            <CommentCard
              key={c.id}
              comment={c}
              change={changes[c.id]}
              n={comments.indexOf(c) + 1}
            />
          ))
        )}
      </div>

      {toast && <div className="toast">{toast}</div>}
    </aside>
  );
}
