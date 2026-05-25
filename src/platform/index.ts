/**
 * Platform abstraction. The app runs both as a Tauri desktop app (real
 * filesystem, native dialogs) and as a plain web app (used during development
 * for fast visual iteration). Everything that touches the OS goes through here.
 */
import type { LoadedDocument } from "../types";

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
