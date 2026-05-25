import { useEffect } from "react";
import { useStore } from "./store/useStore";
import { platform } from "./platform";
import Toolbar from "./components/Toolbar";
import DocumentView from "./components/DocumentView";
import CommentSidebar from "./components/CommentSidebar";
import SidebarSplitter from "./components/SidebarSplitter";
import EmptyState from "./components/EmptyState";
import "./styles/themes.css";
import "./styles/app.css";
import "./styles/markdown.css";
import "katex/dist/katex.min.css";

export default function App() {
  const doc = useStore((s) => s.doc);
  const theme = useStore((s) => s.theme);
  const mode = useStore((s) => s.mode);
  const sidebarVisible = useStore((s) => s.sidebarVisible);
  const sidebarWidth = useStore((s) => s.sidebarWidth);
  const comments = useStore((s) => s.comments);
  const toggleSidebar = useStore((s) => s.toggleSidebar);
  const loadDocument = useStore((s) => s.loadDocument);
  const openCount = comments.filter((c) => c.status === "open").length;

  // Apply theme + mode to the document root for CSS variable cascades.
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.mode = mode;
  }, [theme, mode]);

  // Global file-drop (Tauri OS drop or browser drag-drop).
  useEffect(() => platform.onFileDrop(loadDocument), [loadDocument]);

  return (
    <div className="app">
      <Toolbar />
      <div className="app__body">
        {doc ? (
          <>
            <DocumentView />
            {sidebarVisible ? (
              <>
                <SidebarSplitter />
                <CommentSidebar width={sidebarWidth} />
              </>
            ) : (
              <button
                className="sidebar-reveal"
                onClick={toggleSidebar}
                title="Show comments"
              >
                💬{openCount > 0 ? ` ${openCount}` : ""}
              </button>
            )}
          </>
        ) : (
          <EmptyState />
        )}
      </div>
    </div>
  );
}
