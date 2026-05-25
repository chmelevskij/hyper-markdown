import { useStore, type ThemeName } from "../store/useStore";

const THEMES: { value: ThemeName; label: string }[] = [
  { value: "paper", label: "Paper" },
  { value: "github", label: "GitHub" },
  { value: "midnight", label: "Midnight" },
  { value: "contrast", label: "Contrast" },
];

export default function Toolbar() {
  const doc = useStore((s) => s.doc);
  const theme = useStore((s) => s.theme);
  const mode = useStore((s) => s.mode);
  const safeMode = useStore((s) => s.safeMode);
  const sidebarVisible = useStore((s) => s.sidebarVisible);
  const openDocument = useStore((s) => s.openDocument);
  const setTheme = useStore((s) => s.setTheme);
  const setMode = useStore((s) => s.setMode);
  const toggleSafeMode = useStore((s) => s.toggleSafeMode);
  const toggleSidebar = useStore((s) => s.toggleSidebar);

  return (
    <header className="toolbar">
      <div className="toolbar__left">
        <span className="brand">◆ hyper-markdown</span>
        {doc && (
          <span className="toolbar__doc" title={doc.path}>
            {doc.name}
            <span className="toolbar__badge">{doc.format.toUpperCase()}</span>
          </span>
        )}
      </div>
      <div className="toolbar__right">
        <button className="btn btn--ghost" onClick={openDocument}>
          Open…
        </button>
        <label className="toolbar__field">
          <select value={theme} onChange={(e) => setTheme(e.target.value as ThemeName)}>
            {THEMES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <button
          className="btn btn--ghost"
          title="Toggle light / dark"
          onClick={() => setMode(mode === "dark" ? "light" : "dark")}
        >
          {mode === "dark" ? "☾" : "☀"}
        </button>
        <button
          className={`btn btn--ghost ${safeMode ? "is-active" : ""}`}
          title="Render MDX as plain Markdown (no code execution)"
          onClick={toggleSafeMode}
        >
          {safeMode ? "🔒 Safe" : "🔓 MDX"}
        </button>
        {doc && (
          <button
            className={`btn btn--ghost ${sidebarVisible ? "is-active" : ""}`}
            title="Show / hide comments"
            onClick={toggleSidebar}
          >
            ⬚ Comments
          </button>
        )}
      </div>
    </header>
  );
}
