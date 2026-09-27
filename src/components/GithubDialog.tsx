import { useEffect, useState } from "react";
import { platform } from "../platform";
import type { DeviceCode } from "../platform";
import { useStore } from "../store/useStore";

type Phase = "idle" | "device" | "polling" | "token";

/**
 * Sign in to GitHub. Desktop builds use the device flow (a code to type in the
 * browser); the browser preview, or a build without a client id, takes a
 * pasted token instead.
 */
export default function GithubDialog({ onClose }: { onClose: () => void }) {
  const user = useStore((s) => s.githubUser);
  const setGithubUser = useStore((s) => s.setGithubUser);
  const [phase, setPhase] = useState<Phase>(platform.github.canDeviceFlow() ? "idle" : "token");
  const [code, setCode] = useState<DeviceCode | null>(null);
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const startDevice = async () => {
    setError(null);
    setBusy(true);
    try {
      const dc = await platform.github.deviceStart();
      setCode(dc);
      setPhase("device");
      await platform.copyToClipboard(dc.user_code).catch(() => {});
      await platform.openExternal(dc.verification_uri).catch(() => {});
      setPhase("polling");
      const u = await platform.github.devicePoll(dc);
      setGithubUser(u);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("idle");
    } finally {
      setBusy(false);
    }
  };

  const submitToken = async () => {
    setError(null);
    setBusy(true);
    try {
      const u = await platform.github.setToken(token);
      setGithubUser(u);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    await platform.github.logout();
    setGithubUser(null);
    onClose();
  };

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" role="dialog" aria-label="GitHub" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal__head">
          <h2>GitHub</h2>
          <button className="icon-btn" onClick={onClose} title="Close">
            ✕
          </button>
        </div>

        {user ? (
          <>
            <p className="modal__text">
              Signed in as <strong>@{user.login}</strong>. Documents inside a git checkout can be linked
              to a pull request from the comments sidebar.
            </p>
            <div className="modal__actions">
              <button className="btn btn--ghost" onClick={signOut}>
                Sign out
              </button>
              <button className="btn btn--primary" onClick={onClose}>
                Done
              </button>
            </div>
          </>
        ) : phase === "token" ? (
          <>
            <p className="modal__text">
              Paste a GitHub token with access to pull requests (a fine-grained token with{" "}
              <em>Pull requests: read &amp; write</em> and <em>Contents: read</em>, or a classic token
              with <code>repo</code>).
            </p>
            <input
              className="modal__input"
              type="password"
              autoFocus
              placeholder="github_pat_… / ghp_…"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && token.trim() && submitToken()}
            />
            {error && <p className="modal__error">{error}</p>}
            <div className="modal__actions">
              {platform.github.canDeviceFlow() && (
                <button className="btn btn--ghost" onClick={() => setPhase("idle")}>
                  Use device sign-in
                </button>
              )}
              <button className="btn btn--primary" disabled={!token.trim() || busy} onClick={submitToken}>
                {busy ? "Checking…" : "Sign in"}
              </button>
            </div>
          </>
        ) : (
          <>
            {phase === "idle" && (
              <p className="modal__text">
                Sign in with your GitHub account to pull review threads from a pull request onto the
                document, and to push your comments back as a review.
              </p>
            )}
            {(phase === "device" || phase === "polling") && code && (
              <div className="device-code">
                <p className="modal__text">
                  Enter this code at{" "}
                  <a href={code.verification_uri} onClick={(e) => { e.preventDefault(); platform.openExternal(code.verification_uri); }}>
                    {code.verification_uri}
                  </a>{" "}
                  (it has been copied to your clipboard):
                </p>
                <div className="device-code__code">{code.user_code}</div>
                <p className="modal__hint">Waiting for approval…</p>
              </div>
            )}
            {error && <p className="modal__error">{error}</p>}
            <div className="modal__actions">
              <button className="btn btn--ghost" onClick={() => setPhase("token")}>
                Paste a token instead
              </button>
              {phase === "idle" && (
                <button className="btn btn--primary" disabled={busy} onClick={startDevice}>
                  {busy ? "Starting…" : "Sign in with GitHub"}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
