import { useState } from "react";
import { platform } from "../platform";
import { fetchPrSummary, findPrsForBranch, parsePrUrl } from "../lib/github";
import { useStore, activeTab, activeComments } from "../store/useStore";
import type { GithubPr } from "../types";

/**
 * The sidebar's pull-request strip: link the document to a PR (found from the
 * checkout's branch, or pasted), then pull threads down / push comments up.
 */
export default function PullRequestPanel({ flash }: { flash: (msg: string) => void }) {
  const doc = useStore((s) => activeTab(s)?.doc ?? null);
  const pr = useStore((s) => activeTab(s)?.pr ?? null);
  const comments = useStore(activeComments);
  const user = useStore((s) => s.githubUser);
  const busy = useStore((s) => s.githubBusy);
  const linkPr = useStore((s) => s.linkPr);
  const pullFromGithub = useStore((s) => s.pullFromGithub);
  const pushToGithub = useStore((s) => s.pushToGithub);
  const [linking, setLinking] = useState(false);
  const [input, setInput] = useState("");
  const [working, setWorking] = useState(false);

  if (!user) return null;

  const unpushed = comments.filter((c) => !c.github && c.status === "open").length;

  const report = (e: unknown) => flash(e instanceof Error ? e.message : String(e));

  /** Link to the PR for this checkout's branch, or fall back to asking for a URL. */
  const autoLink = async () => {
    if (!doc) return;
    setWorking(true);
    try {
      const repo = await platform.repoForPath(doc.path);
      if (!repo || repo.host !== "github.com" || !repo.branch) {
        setLinking(true);
        return;
      }
      const prs = await findPrsForBranch(repo.owner, repo.repo, repo.branch);
      if (prs.length === 0) {
        flash(`No open PR for ${repo.branch}`);
        setLinking(true);
        return;
      }
      const p = prs[0];
      linkPr({ owner: repo.owner, repo: repo.repo, number: p.number, url: p.url, headSha: p.headSha, path: repo.rel_path });
      flash(`Linked #${p.number} · ${p.title}`);
    } catch (e) {
      report(e);
    } finally {
      setWorking(false);
    }
  };

  const linkFromInput = async () => {
    if (!doc) return;
    const ref = parsePrUrl(input);
    if (!ref) {
      flash("Paste a PR URL like https://github.com/owner/repo/pull/12");
      return;
    }
    setWorking(true);
    try {
      const summary = await fetchPrSummary(ref);
      const repo = await platform.repoForPath(doc.path);
      const path = repo && repo.owner === ref.owner && repo.repo === ref.repo ? repo.rel_path : doc.name;
      const next: GithubPr = { ...ref, url: summary.url, headSha: summary.headSha, path };
      linkPr(next);
      setLinking(false);
      setInput("");
      flash(`Linked #${summary.number} · ${summary.title}`);
    } catch (e) {
      report(e);
    } finally {
      setWorking(false);
    }
  };

  const pull = async () => {
    try {
      const r = await pullFromGithub();
      flash(`Pulled ${r.added} new, ${r.updated} updated`);
    } catch (e) {
      report(e);
    }
  };

  const push = async () => {
    try {
      const r = await pushToGithub();
      flash(
        r.summarized
          ? `Pushed ${r.pushed} inline, ${r.summarized} as a PR comment`
          : `Pushed ${r.pushed} comment${r.pushed === 1 ? "" : "s"}`,
      );
    } catch (e) {
      report(e);
    }
  };

  return (
    <div className="pr-panel">
      {pr ? (
        <>
          <div className="pr-panel__row">
            <a
              className="pr-panel__link"
              href={pr.url}
              title={`${pr.owner}/${pr.repo} · ${pr.path}`}
              onClick={(e) => {
                e.preventDefault();
                platform.openExternal(pr.url);
              }}
            >
              <span className="pr-panel__icon">⎇</span> {pr.owner}/{pr.repo}#{pr.number}
            </a>
            <button className="icon-btn" title="Unlink pull request" onClick={() => linkPr(null)}>
              ✕
            </button>
          </div>
          <div className="sidebar__export-row">
            <button className="btn btn--ghost" disabled={busy} onClick={pull}>
              {busy ? "…" : "↓ Pull"}
            </button>
            <button className="btn btn--ghost" disabled={busy || unpushed === 0} onClick={push}>
              ↑ Push{unpushed ? ` (${unpushed})` : ""}
            </button>
          </div>
        </>
      ) : linking ? (
        <div className="pr-panel__form">
          <input
            className="modal__input"
            autoFocus
            placeholder="https://github.com/owner/repo/pull/12"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") linkFromInput();
              if (e.key === "Escape") setLinking(false);
            }}
          />
          <div className="sidebar__export-row">
            <button className="btn btn--ghost" onClick={() => setLinking(false)}>
              Cancel
            </button>
            <button className="btn btn--primary" disabled={working || !input.trim()} onClick={linkFromInput}>
              Link
            </button>
          </div>
        </div>
      ) : (
        <button className="btn btn--ghost" disabled={working} onClick={autoLink}>
          {working ? "Looking up PR…" : "⎇ Link pull request…"}
        </button>
      )}
    </div>
  );
}
