import type { HighlighterCore } from "shiki";

/**
 * Lazily-created Shiki highlighter shared across all code blocks. Languages are
 * loaded on demand so the first render isn't blocked on the full grammar set.
 */
let highlighterPromise: Promise<HighlighterCore> | null = null;

const PRELOADED_LANGS = [
  "javascript",
  "typescript",
  "tsx",
  "jsx",
  "json",
  "bash",
  "shell",
  "python",
  "rust",
  "go",
  "css",
  "html",
  "markdown",
  "yaml",
  "sql",
];

export const CODE_THEMES = { light: "min-light", dark: "min-dark" } as const;

async function getHighlighter(): Promise<HighlighterCore> {
  if (!highlighterPromise) {
    const { createHighlighter } = await import("shiki");
    highlighterPromise = createHighlighter({
      themes: [CODE_THEMES.light, CODE_THEMES.dark],
      langs: PRELOADED_LANGS,
    });
  }
  return highlighterPromise;
}

/** Highlight a code block to themed HTML, loading the language on demand. */
export async function highlightCode(
  code: string,
  lang: string | undefined,
  theme: "light" | "dark",
): Promise<string> {
  const hl = await getHighlighter();
  let language = "text";
  if (lang) {
    if (!hl.getLoadedLanguages().includes(lang)) {
      try {
        await hl.loadLanguage(lang as never);
      } catch {
        /* unknown language → plain text */
      }
    }
    if (hl.getLoadedLanguages().includes(lang)) language = lang;
  }
  return hl.codeToHtml(code, { lang: language, theme: CODE_THEMES[theme] });
}
