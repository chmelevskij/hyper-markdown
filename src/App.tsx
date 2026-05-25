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
  const mode = useStore((s) => s.mode);
  const viewMode = useStore((s) => s.viewMode);
  const sidebarWidth = useStore((s) => s.sidebarWidth);
  const loadDocument = useStore((s) => s.loadDocument);

  // Apply mode to the document root for CSS variable cascades.
  useEffect(() => {
    document.documentElement.dataset.mode = mode;
  }, [mode]);

  // Global file-drop (Tauri OS drop or browser drag-drop).
  useEffect(() => platform.onFileDrop(loadDocument), [loadDocument]);

  return (
    <div className="app">
      <Toolbar />
      <div className="app__body">
        {doc ? (
          <>
            <DocumentView />
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
