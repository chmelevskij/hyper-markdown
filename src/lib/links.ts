/**
 * Link helpers for the document renderer.
 *
 * We categorise hrefs into four buckets so the renderer can decide what to do
 * with a click and what to surface in the hover preview:
 *
 *   external — `http://` / `https://`
 *   other    — any other scheme (`mailto:`, `file:`, …); we leave these alone
 *   anchor   — `#fragment` inside the current document
 *   absolute — starts with `/`; treated as an OS-absolute path
 *   relative — anything else, resolved against the host document's directory
 */

export type LinkKind = "external" | "other" | "anchor" | "absolute" | "relative" | "empty";

export function categorizeLink(href: string | undefined): LinkKind {
  if (!href) return "empty";
  if (/^https?:\/\//i.test(href)) return "external";
  if (href.startsWith("#")) return "anchor";
  if (/^[a-zA-Z][a-zA-Z0-9+.\-]*:/.test(href)) return "other";
  if (href.startsWith("/")) return "absolute";
  return "relative";
}

export interface ResolvedTarget {
  /** Absolute filesystem path. */
  path: string;
  /** Optional `#fragment` from the original href, undecoded. */
  fragment?: string;
}

/** True for filenames the app can render in-place (rather than handing off to the OS). */
export function isMarkdownPath(path: string): boolean {
  return /\.(md|mdx|markdown)$/i.test(path);
}

/**
 * Resolve a relative or absolute-path href against the document's location.
 *
 * The docPath is treated as an OS path (so `..` and `.` segments behave as on
 * disk); the href is the URL-form authored in Markdown, so `/` is the segment
 * separator regardless of the host OS and percent-escapes are decoded.
 */
export function resolveLinkPath(
  docPath: string,
  href: string,
  kind: "relative" | "absolute",
): ResolvedTarget {
  const hashIdx = href.indexOf("#");
  const filePart = hashIdx >= 0 ? href.slice(0, hashIdx) : href;
  const fragment = hashIdx >= 0 ? href.slice(hashIdx + 1) : undefined;

  let decoded = filePart;
  try {
    decoded = decodeURI(filePart);
  } catch {
    /* keep raw on malformed escape */
  }

  if (kind === "absolute") {
    return { path: decoded, fragment };
  }

  // Empty file part with only a fragment → same document.
  if (!decoded) return { path: docPath, fragment };

  const sep = docPath.includes("\\") && !docPath.includes("/") ? "\\" : "/";
  const parts = docPath.split(/[\\/]/);
  parts.pop(); // drop the document filename

  for (const seg of decoded.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (parts.length > 0) parts.pop();
    } else {
      parts.push(seg);
    }
  }

  return { path: parts.join(sep), fragment };
}
