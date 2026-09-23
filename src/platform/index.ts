/**
 * Platform abstraction. The app runs both as a Tauri desktop app (real
 * filesystem, native dialogs) and as a plain web app (used during development
 * for fast visual iteration). Everything that touches the OS goes through here.
 */
import type { LoadedDocument } from "../types";

/** Who is signed in to GitHub. */
export interface GithubUser {
  login: string;
  avatar_url?: string | null;
}

/** Device-flow handshake returned by GitHub (shown to the user, then polled). */
export interface DeviceCode {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

export interface ApiResponse {
  status: number;
  body: unknown;
}

/** The git repository a document belongs to. */
export interface RepoInfo {
  root: string;
  host: string;
  owner: string;
  repo: string;
  branch: string | null;
  rel_path: string;
}

const GH_CLIENT_ID = (import.meta.env.VITE_GITHUB_CLIENT_ID as string | undefined) ?? "";
const LS_GH_TOKEN = "hmd:github:token";

export const isTauri = (): boolean =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const formatFor = (name: string): "md" | "mdx" =>
  name.toLowerCase().endsWith(".mdx") ? "mdx" : "md";

const baseName = (path: string): string =>
  path.split(/[\\/]/).pop() || path;

// ---------------------------------------------------------------------------
// Tauri implementation
// ---------------------------------------------------------------------------

async function tauriOpenDocument(): Promise<LoadedDocument | null> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const { invoke } = await import("@tauri-apps/api/core");
  const selected = await open({
    multiple: false,
    filters: [{ name: "Markdown", extensions: ["md", "mdx", "markdown"] }],
  });
  if (typeof selected !== "string") return null;
  const source = await invoke<string>("read_text_file", { path: selected });
  return { path: selected, name: baseName(selected), source, format: formatFor(selected) };
}

async function tauriImportTextFile(): Promise<{ name: string; text: string } | null> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const { invoke } = await import("@tauri-apps/api/core");
  const selected = await open({
    multiple: false,
    filters: [{ name: "Comments", extensions: ["md", "json", "markdown"] }],
  });
  if (typeof selected !== "string") return null;
  const text = await invoke<string>("read_text_file", { path: selected });
  return { name: baseName(selected), text };
}

async function tauriReadPath(path: string): Promise<LoadedDocument> {
  const { invoke } = await import("@tauri-apps/api/core");
  const source = await invoke<string>("read_text_file", { path });
  return { path, name: baseName(path), source, format: formatFor(path) };
}

/** Sidecar path: `<doc>.hmd-comments.json` next to the document. */
function sidecarPath(docPath: string): string {
  return `${docPath}.hmd-comments.json`;
}

async function tauriLoadComments(docPath: string): Promise<string | null> {
  const { invoke } = await import("@tauri-apps/api/core");
  const p = sidecarPath(docPath);
  const exists = await invoke<boolean>("path_exists", { path: p });
  if (!exists) return null;
  return invoke<string>("read_text_file", { path: p });
}

async function tauriSaveComments(docPath: string, json: string): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("write_text_file", { path: sidecarPath(docPath), contents: json });
}

async function tauriWriteExport(
  defaultName: string,
  contents: string,
): Promise<string | null> {
  const { save } = await import("@tauri-apps/plugin-dialog");
  const { invoke } = await import("@tauri-apps/api/core");
  const target = await save({ defaultPath: defaultName });
  if (!target) return null;
  await invoke("write_text_file", { path: target, contents });
  return target;
}

async function tauriOnFileDrop(cb: (doc: LoadedDocument) => void): Promise<() => void> {
  const { getCurrentWebview } = await import("@tauri-apps/api/webview");
  const unlisten = await getCurrentWebview().onDragDropEvent(async (event) => {
    if (event.payload.type === "drop") {
      const paths = event.payload.paths.filter((p) => /\.(md|mdx|markdown)$/i.test(p));
      if (paths[0]) cb(await tauriReadPath(paths[0]));
    }
  });
  return unlisten;
}

// ---------------------------------------------------------------------------
// Browser fallback
// ---------------------------------------------------------------------------

/**
 * Browser preview keeps a pasted token in localStorage and calls the API with
 * fetch — api.github.com sends CORS headers, the device-flow endpoints do not,
 * so sign-in there is token-paste only.
 */
async function browserGithubRequest(
  method: string,
  path: string,
  body?: unknown,
): Promise<ApiResponse> {
  const token = localStorage.getItem(LS_GH_TOKEN);
  if (!token) throw new Error("Not signed in to GitHub");
  const url = path.startsWith("http") ? path : `https://api.github.com${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* keep text */
  }
  return { status: res.status, body: parsed };
}

async function browserWhoami(token: string): Promise<GithubUser> {
  const res = await fetch("https://api.github.com/user", {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
  });
  if (!res.ok) throw new Error(`GitHub rejected the token (HTTP ${res.status})`);
  const u = (await res.json()) as GithubUser;
  return { login: u.login, avatar_url: u.avatar_url };
}

function browserPickFile(): Promise<LoadedDocument | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".md,.mdx,.markdown,text/markdown";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      const source = await file.text();
      resolve({ path: file.name, name: file.name, source, format: formatFor(file.name) });
    };
    input.click();
  });
}

const commentKey = (docPath: string) => `hmd:comments:${docPath}`;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const platform = {
  isTauri,

  openDocument(): Promise<LoadedDocument | null> {
    return isTauri() ? tauriOpenDocument() : browserPickFile();
  },

  /** Read a document by absolute path (Tauri only; browser can't re-read paths). */
  async readDocument(path: string): Promise<LoadedDocument | null> {
    if (!isTauri()) return null;
    return tauriReadPath(path);
  },

  /**
   * Watch the given document paths for external edits. Calls `onChange(path)`
   * (debounced) when a file changes. Tauri only; returns an unsubscribe fn.
   */
  watchFiles(paths: string[], onChange: (path: string) => void): () => void {
    if (!isTauri() || paths.length === 0) return () => {};
    let cancelled = false;
    let teardown = () => {};
    const timers = new Map<string, ReturnType<typeof setTimeout>>();
    const debounced = (p: string) => {
      clearTimeout(timers.get(p));
      timers.set(p, setTimeout(() => onChange(p), 150));
    };
    (async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      const { listen } = await import("@tauri-apps/api/event");
      for (const p of paths) {
        try {
          await invoke("watch_file", { path: p });
        } catch (e) {
          console.error("watch_file failed", e);
        }
      }
      const unlisten = await listen<string>("file-changed", (e) => {
        if (typeof e.payload === "string" && paths.includes(e.payload)) debounced(e.payload);
      });
      if (cancelled) {
        unlisten();
        return;
      }
      teardown = () => {
        unlisten();
        for (const p of paths) invoke("unwatch_file", { path: p }).catch(() => {});
        timers.forEach((t) => clearTimeout(t));
      };
    })();
    return () => {
      cancelled = true;
      teardown();
    };
  },

  /**
   * Subscribe to documents the OS hands us (the `hmd` CLI / Finder open).
   * Drains any files captured before the listener attached. Tauri only.
   */
  onOpenFile(cb: (doc: LoadedDocument) => void): () => void {
    if (!isTauri()) return () => {};
    let unlisten = () => {};
    (async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      const { listen } = await import("@tauri-apps/api/event");
      try {
        const pending = await invoke<string[]>("take_pending_files");
        for (const p of pending ?? []) cb(await tauriReadPath(p));
      } catch (e) {
        console.error("take_pending_files failed", e);
      }
      unlisten = await listen<string>("open-file", async (e) => {
        if (typeof e.payload === "string") {
          try {
            cb(await tauriReadPath(e.payload));
          } catch (err) {
            console.error("open-file read failed", err);
          }
        }
      });
    })();
    return () => unlisten();
  },

  /**
   * Subscribe to the native File ▸ Close Tab menu item (⌘W). Tauri/macOS
   * only — in the browser ⌘W belongs to the browser itself. Returns an
   * unsubscribe fn.
   */
  onCloseTab(cb: () => void): () => void {
    if (!isTauri()) return () => {};
    let unlisten = () => {};
    (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      unlisten = await listen("close-tab", () => cb());
    })();
    return () => unlisten();
  },

  /** Close the current native window (Tauri only). */
  async closeWindow(): Promise<void> {
    if (!isTauri()) return;
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().close();
  },

  importTextFile(): Promise<{ name: string; text: string } | null> {
    if (isTauri()) return tauriImportTextFile();
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".md,.markdown,.json,application/json,text/markdown";
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return resolve(null);
        resolve({ name: file.name, text: await file.text() });
      };
      input.click();
    });
  },

  async loadComments(docPath: string): Promise<string | null> {
    if (isTauri()) return tauriLoadComments(docPath);
    return localStorage.getItem(commentKey(docPath));
  },

  async saveComments(docPath: string, json: string): Promise<void> {
    if (isTauri()) return tauriSaveComments(docPath, json);
    localStorage.setItem(commentKey(docPath), json);
  },

  async writeExport(defaultName: string, contents: string): Promise<string | null> {
    if (isTauri()) return tauriWriteExport(defaultName, contents);
    const blob = new Blob([contents], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = defaultName;
    a.click();
    URL.revokeObjectURL(url);
    return defaultName;
  },

  /** Open a URL in the system browser. */
  async openExternal(url: string): Promise<void> {
    if (isTauri()) {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(url);
      return;
    }
    window.open(url, "_blank", "noopener");
  },

  /** Which git repository (and remote) a document lives in. Tauri only. */
  async repoForPath(docPath: string): Promise<RepoInfo | null> {
    if (!isTauri()) return null;
    const { invoke } = await import("@tauri-apps/api/core");
    return (await invoke<RepoInfo | null>("git_repo_info", { path: docPath })) ?? null;
  },

  github: {
    /** Client id of the GitHub App; empty when the build was made without one. */
    clientId: GH_CLIENT_ID,
    /** Device flow needs the native side (github.com sends no CORS headers). */
    canDeviceFlow: () => isTauri() && GH_CLIENT_ID !== "",

    async status(): Promise<GithubUser | null> {
      if (isTauri()) {
        const { invoke } = await import("@tauri-apps/api/core");
        return (await invoke<GithubUser | null>("github_auth_status")) ?? null;
      }
      const token = localStorage.getItem(LS_GH_TOKEN);
      if (!token) return null;
      try {
        return await browserWhoami(token);
      } catch {
        return null;
      }
    },

    async deviceStart(): Promise<DeviceCode> {
      const { invoke } = await import("@tauri-apps/api/core");
      return invoke<DeviceCode>("github_device_start", { clientId: GH_CLIENT_ID });
    },

    async devicePoll(code: DeviceCode): Promise<GithubUser> {
      const { invoke } = await import("@tauri-apps/api/core");
      return invoke<GithubUser>("github_device_poll", { clientId: GH_CLIENT_ID, code });
    },

    async setToken(token: string): Promise<GithubUser> {
      if (isTauri()) {
        const { invoke } = await import("@tauri-apps/api/core");
        return invoke<GithubUser>("github_set_token", { token });
      }
      const user = await browserWhoami(token.trim());
      localStorage.setItem(LS_GH_TOKEN, token.trim());
      return user;
    },

    async logout(): Promise<void> {
      if (isTauri()) {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("github_logout");
        return;
      }
      localStorage.removeItem(LS_GH_TOKEN);
    },

    async request(method: string, path: string, body?: unknown): Promise<ApiResponse> {
      if (isTauri()) {
        const { invoke } = await import("@tauri-apps/api/core");
        return invoke<ApiResponse>("github_request", { method, path, body: body ?? null });
      }
      return browserGithubRequest(method, path, body);
    },
  },

  async copyToClipboard(text: string): Promise<void> {
    await navigator.clipboard.writeText(text);
  },

  /** Subscribe to OS file-drop (Tauri) or window drag/drop (browser). Returns an unsubscribe fn. */
  onFileDrop(cb: (doc: LoadedDocument) => void): () => void {
    if (isTauri()) {
      let unlisten = () => {};
      tauriOnFileDrop(cb).then((fn) => (unlisten = fn));
      return () => unlisten();
    }
    const onDrop = async (e: DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer?.files?.[0];
      if (file && /\.(md|mdx|markdown)$/i.test(file.name)) {
        const source = await file.text();
        cb({ path: file.name, name: file.name, source, format: formatFor(file.name) });
      }
    };
    const onDragOver = (e: DragEvent) => e.preventDefault();
    window.addEventListener("drop", onDrop);
    window.addEventListener("dragover", onDragOver);
    return () => {
      window.removeEventListener("drop", onDrop);
      window.removeEventListener("dragover", onDragOver);
    };
  },
};
