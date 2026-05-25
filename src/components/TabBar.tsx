import { useStore } from "../store/useStore";

export default function TabBar() {
  const tabs = useStore((s) => s.tabs);
  const activeTabId = useStore((s) => s.activeTabId);
  const setActiveTab = useStore((s) => s.setActiveTab);
  const closeTab = useStore((s) => s.closeTab);
  const openDocument = useStore((s) => s.openDocument);

  return (
    <div className="tabbar" role="tablist">
      {tabs.map((t) => {
        const open = t.comments.filter((c) => c.status === "open").length;
        return (
          <div
            key={t.id}
            className={`tab ${t.id === activeTabId ? "is-active" : ""}`}
            role="tab"
            aria-selected={t.id === activeTabId}
            title={t.doc.path}
            onClick={() => setActiveTab(t.id)}
            onAuxClick={(e) => {
              // middle-click closes
              if (e.button === 1) {
                e.preventDefault();
                closeTab(t.id);
              }
            }}
          >
            <span className="tab__name">{t.doc.name}</span>
            {open > 0 && <span className="tab__count">{open}</span>}
            <button
              className="tab__close"
              title="Close tab"
              onClick={(e) => {
                e.stopPropagation();
                closeTab(t.id);
              }}
            >
              ✕
            </button>
          </div>
        );
      })}
      <button className="tab__new" title="Open a document" onClick={openDocument}>
        +
      </button>
    </div>
  );
}
