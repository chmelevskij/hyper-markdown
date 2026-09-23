import { useState } from "react";
import { useStore, activeTab } from "../store/useStore";
import GithubDialog from "./GithubDialog";

export default function Toolbar() {
  const githubUser = useStore((s) => s.githubUser);
  const [showGithub, setShowGithub] = useState(false);
  const doc = useStore((s) => activeTab(s)?.doc ?? null);
  const mode = useStore((s) => s.mode);
  const viewMode = useStore((s) => s.viewMode);
  const safeMode = useStore((s) => s.safeMode);
  const openDocument = useStore((s) => s.openDocument);
  const setMode = useStore((s) => s.setMode);
  const setViewMode = useStore((s) => s.setViewMode);
  const toggleSafeMode = useStore((s) => s.toggleSafeMode);

  return (
    <header className="toolbar">
      <div className="toolbar__left">
        <span className="brand">
          <span className="brand__mark">◆</span> hyper-markdown
        </span>
        {doc && (
          <span className="toolbar__doc" title={doc.path}>
            {doc.name}
            <span className="toolbar__badge">{doc.format.toUpperCase()}</span>
          </span>
        )}
      </div>
      <div className="toolbar__right">
        <button className="btn" onClick={openDocument}>
          Open…
        </button>
        {doc && (
          <div className="seg" role="group" aria-label="View mode">
            <button
              className={`seg__btn ${viewMode === "reading" ? "is-active" : ""}`}
              onClick={() => setViewMode("reading")}
            >
              📖 Read
            </button>
            <button
              className={`seg__btn ${viewMode === "comment" ? "is-active" : ""}`}
              onClick={() => setViewMode("comment")}
            >
              💬 Comment
            </button>
          </div>
        )}
        {doc && (
          <button
            className={`btn ${safeMode ? "is-active" : ""}`}
            title="Render MDX as plain Markdown (no code execution)"
            onClick={toggleSafeMode}
          >
            {safeMode ? "🔒 Safe" : "🔓 MDX"}
          </button>
        )}
        <button
          className={`btn ${githubUser ? "is-active" : ""}`}
          title={githubUser ? `Signed in to GitHub as @${githubUser.login}` : "Sign in to GitHub"}
          onClick={() => setShowGithub(true)}
        >
          ⎇ {githubUser ? <span className="toolbar__login">@{githubUser.login}</span> : "GitHub"}
        </button>
        <button
          className="btn"
          title="Toggle light / dark"
          onClick={() => setMode(mode === "dark" ? "light" : "dark")}
        >
          {mode === "dark" ? "☾" : "☀"}
        </button>
      </div>
      {showGithub && <GithubDialog onClose={() => setShowGithub(false)} />}
    </header>
  );
}
