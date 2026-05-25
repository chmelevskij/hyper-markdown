import { evaluate } from "@mdx-js/mdx";
import * as runtime from "react/jsx-runtime";
import remarkGfm from "remark-gfm";
import remarkFrontmatter from "remark-frontmatter";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import type { MDXComponents } from "mdx/types";
import type { ComponentType } from "react";
import rehypeSourceLine from "./rehypeSourceLine";

export interface CompileOptions {
  /** `mdx` enables JSX/expressions; `md` is plain CommonMark (also used for safe mode). */
  format: "md" | "mdx";
}

export type MDXContent = ComponentType<{ components?: MDXComponents }>;

/**
 * Compile a Markdown/MDX string into a React component at runtime.
 * Frontmatter is parsed (and thus hidden from the rendered body); GFM, math and
 * source-line stamping are always applied.
 */
export async function compileDocument(
  source: string,
  { format }: CompileOptions,
): Promise<MDXContent> {
  const { default: Content } = await evaluate(source, {
    ...runtime,
    format,
    remarkPlugins: [remarkFrontmatter, remarkGfm, remarkMath],
    rehypePlugins: [rehypeKatex, rehypeSourceLine],
    development: false,
  });
  return Content as MDXContent;
}

/** Extract a leading YAML frontmatter block, if present. */
export function splitFrontmatter(source: string): { frontmatter: string | null; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(source);
  if (!match) return { frontmatter: null, body: source };
  return { frontmatter: match[1], body: source.slice(match[0].length) };
}
