import { useEffect } from "react";
import { useStore } from "./store/useStore";
import { platform } from "./platform";
import Toolbar from "./components/Toolbar";
import TabBar from "./components/TabBar";
import DocumentView from "./components/DocumentView";
import CommentSidebar from "./components/CommentSidebar";
import SidebarSplitter from "./components/SidebarSplitter";
import EmptyState from "./components/EmptyState";
import "@fontsource-variable/hanken-grotesk";
import "./styles/themes.css";
import "./styles/app.css";
import "./styles/markdown.css";
import "katex/dist/katex.min.css";

export default function App() {
  const tabs = useStore((s) => s.tabs);
  const activeTabId = useStore((s) => s.activeTabId);
  const hasDoc = tabs.length > 0;
  const mode = useStore((s) => s.mode);
  const viewMode = useStore((s) => s.viewMode);
  const sidebarWidth = useStore((s) => s.sidebarWidth);
  const loadDocument = useStore((s) => s.loadDocument);
  const restoreSession = useStore((s) => s.restoreSession);
  const reloadTabByPath = useStore((s) => s.reloadTabByPath);

  // Apply mode to the document root for CSS variable cascades.
  useEffect(() => {
    document.documentElement.dataset.mode = mode;
  }, [mode]);

  // Global file-drop (Tauri OS drop or browser drag-drop).
  useEffect(() => platform.onFileDrop(loadDocument), [loadDocument]);

  // ⌘W (native File ▸ Close Tab): close the active tab, or the window
  // once no tabs remain.
  useEffect(
    () =>
      platform.onCloseTab(() => {
        const { activeTabId, closeTab } = useStore.getState();
        if (activeTabId) closeTab(activeTabId);
        else platform.closeWindow();
      }),
    [],
  );

  // Restore the previous session, then open files handed to us by the OS
  // (the `hmd` CLI / Finder) for the lifetime of the app.
  useEffect(() => {
    restoreSession();
    return platform.onOpenFile(loadDocument);
  }, [restoreSession, loadDocument]);

  // Who is signed in to GitHub (the token lives in the keychain / localStorage).
  useEffect(() => {
    platform.github
      .status()
      .then((u) => useStore.getState().setGithubUser(u))
      .catch(() => useStore.getState().setGithubUser(null));
  }, []);

  // Live reload: watch every open document and refresh on external edits.
  const pathsKey = tabs.map((t) => t.doc.path).join("\n");
  useEffect(() => {
    const paths = pathsKey ? pathsKey.split("\n") : [];
    return platform.watchFiles(paths, async (changed) => {
      const doc = await platform.readDocument(changed).catch(() => null);
      if (doc) reloadTabByPath(changed, doc.source);
    });
  }, [pathsKey, reloadTabByPath]);

  return (
    <div className="app">
      <Toolbar />
      {hasDoc && <TabBar />}
      <div className="app__body">
        {hasDoc ? (
          <>
            <DocumentView key={activeTabId} />
            {viewMode === "comment" && (
              <>
                <SidebarSplitter />
                <CommentSidebar width={sidebarWidth} />
              </>
            )}
          </>
        ) : (
          <EmptyState />
        )}
      </div>
    </div>
  );
}
