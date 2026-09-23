/**
 * GitHub pull-request sync.
 *
 * Review threads on a PR map onto hyper-markdown comments: the thread's line
 * range on the head commit becomes the anchor's source lines, the source at
 * those lines becomes the quote (plus a baseline hash, so the existing
 * edited/removed detection keeps working against the local file), and the
 * thread's conversation becomes the body. Local comments go the other way as
 * one PR review with inline comments.
 *
 * All HTTP goes through `platform.github.request`, which attaches the token
 * natively (Tauri) or from localStorage (browser preview).
 */
import { platform } from "../platform";
import type { Comment, GithubLink, GithubPr } from "../types";
import type { ImportedComment } from "./importComments";
import { hashSource, sliceSourceLines } from "./changes";

export class GithubError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
  }
}

function messageOf(body: unknown, status: number): string {
  if (body && typeof body === "object") {
    const b = body as { message?: string; errors?: { message?: string }[] };
    const detail = b.errors?.map((e) => e.message).filter(Boolean).join("; ");
    if (b.message) return detail ? `${b.message} (${detail})` : b.message;
  }
  if (typeof body === "string" && body.trim()) return body.slice(0, 200);
  return `GitHub returned HTTP ${status}`;
}

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await platform.github.request(method, path, body);
  if (res.status >= 400) throw new GithubError(messageOf(res.body, res.status), res.status);
  return res.body as T;
}

async function graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await api<{ data?: T; errors?: { message: string }[] }>("POST", "/graphql", {
    query,
    variables,
  });
  if (res.errors?.length) throw new GithubError(res.errors.map((e) => e.message).join("; "));
  if (!res.data) throw new GithubError("Empty GraphQL response");
  return res.data;
}

// ---------------------------------------------------------------------------
// Locating a pull request
// ---------------------------------------------------------------------------

export interface PrRef {
  owner: string;
  repo: string;
  number: number;
}

/** `https://github.com/o/r/pull/12`, `o/r#12`, or `o/r/pull/12`. */
export function parsePrUrl(input: string): PrRef | null {
  const s = input.trim();
  const url = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)/i.exec(s);
  if (url) return { owner: url[1], repo: url[2], number: Number(url[3]) };
  const short = /^([^/\s#]+)\/([^/\s#]+)(?:#|\/pull\/)(\d+)$/.exec(s);
  if (short) return { owner: short[1], repo: short[2], number: Number(short[3]) };
  return null;
}

export interface PrSummary {
  number: number;
  title: string;
  url: string;
  headSha: string;
  headRefName: string;
  state: "OPEN" | "CLOSED" | "MERGED";
}

const PR_FIELDS = `number title url headRefOid headRefName state`;

/** Open PRs whose head is `branch` — how a document finds its own PR. */
export async function findPrsForBranch(owner: string, repo: string, branch: string): Promise<PrSummary[]> {
  const data = await graphql<{
    repository: { pullRequests: { nodes: RawPr[] } };
  }>(
    `query($owner:String!,$repo:String!,$branch:String!){
      repository(owner:$owner,name:$repo){
        pullRequests(headRefName:$branch,states:[OPEN],first:5,orderBy:{field:UPDATED_AT,direction:DESC}){
          nodes{ ${PR_FIELDS} }
        }
      }
    }`,
    { owner, repo, branch },
  );
  return data.repository.pullRequests.nodes.map(toSummary);
}

interface RawPr {
  number: number;
  title: string;
  url: string;
  headRefOid: string;
  headRefName: string;
  state: "OPEN" | "CLOSED" | "MERGED";
}

const toSummary = (p: RawPr): PrSummary => ({
  number: p.number,
  title: p.title,
  url: p.url,
  headSha: p.headRefOid,
  headRefName: p.headRefName,
  state: p.state,
});

export async function fetchPrSummary(ref: PrRef): Promise<PrSummary> {
  const data = await graphql<{ repository: { pullRequest: RawPr } }>(
    `query($owner:String!,$repo:String!,$number:Int!){
      repository(owner:$owner,name:$repo){ pullRequest(number:$number){ ${PR_FIELDS} } }
    }`,
    { owner: ref.owner, repo: ref.repo, number: ref.number },
  );
  return toSummary(data.repository.pullRequest);
}

// ---------------------------------------------------------------------------
// Pulling review threads
// ---------------------------------------------------------------------------

export interface RemoteComment {
  nodeId: string;
  databaseId: number;
  body: string;
  author: string;
  url: string;
  createdAt: string;
  updatedAt: string;
}

export interface RemoteThread {
  id: string;
  isResolved: boolean;
  isOutdated: boolean;
  path: string;
  /** Line range on the head commit (RIGHT side); null when the diff no longer has it. */
  line: number | null;
  startLine: number | null;
  diffSide: "LEFT" | "RIGHT";
  comments: RemoteComment[];
}

interface RawThread {
  id: string;
  isResolved: boolean;
  isOutdated: boolean;
  path: string;
  line: number | null;
  startLine: number | null;
  originalLine: number | null;
  originalStartLine: number | null;
  diffSide: "LEFT" | "RIGHT";
  comments: {
    nodes: {
      id: string;
      databaseId: number;
      body: string;
      author: { login: string } | null;
      url: string;
      createdAt: string;
      updatedAt: string;
    }[];
  };
}

/** Every review thread on the PR (all files), paginated. */
export async function fetchThreads(ref: PrRef): Promise<RemoteThread[]> {
  const out: RemoteThread[] = [];
  let cursor: string | null = null;
  for (;;) {
    const data: {
      repository: {
        pullRequest: {
          reviewThreads: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: RawThread[] };
        };
      };
    } = await graphql(
      `query($owner:String!,$repo:String!,$number:Int!,$cursor:String){
        repository(owner:$owner,name:$repo){
          pullRequest(number:$number){
            reviewThreads(first:100,after:$cursor){
              pageInfo{ hasNextPage endCursor }
              nodes{
                id isResolved isOutdated path line startLine originalLine originalStartLine diffSide
                comments(first:100){
                  nodes{ id databaseId body author{ login } url createdAt updatedAt }
                }
              }
            }
          }
        }
      }`,
      { owner: ref.owner, repo: ref.repo, number: ref.number, cursor },
    );
    const page = data.repository.pullRequest.reviewThreads;
    for (const t of page.nodes) {
      out.push({
        id: t.id,
        isResolved: t.isResolved,
        isOutdated: t.isOutdated,
        path: t.path,
        line: t.line ?? t.originalLine,
        startLine: t.startLine ?? t.originalStartLine,
        diffSide: t.diffSide,
        comments: t.comments.nodes.map((c) => ({
          nodeId: c.id,
          databaseId: c.databaseId,
          body: c.body,
          author: c.author?.login ?? "ghost",
          url: c.url,
          createdAt: c.createdAt,
          updatedAt: c.updatedAt,
        })),
      });
    }
    if (!page.pageInfo.hasNextPage) break;
    cursor = page.pageInfo.endCursor;
  }
  return out;
}

/** The document's text at a commit, or null when it does not exist there. */
export async function fetchFileAt(ref: PrRef, sha: string, path: string): Promise<string | null> {
  const data = await graphql<{ repository: { object: { text: string; isTruncated: boolean } | null } }>(
    `query($owner:String!,$repo:String!,$expr:String!){
      repository(owner:$owner,name:$repo){ object(expression:$expr){ ... on Blob { text isTruncated } } }
    }`,
    { owner: ref.owner, repo: ref.repo, expr: `${sha}:${path}` },
  );
  const blob = data.repository.object;
  if (!blob) return null;
  if (blob.isTruncated) throw new GithubError("The file is too large to fetch through the GitHub API.");
  return blob.text;
}

/**
 * Best-effort rendered text for a slice of Markdown source, so the quote can
 * be found in the rendered document's textContent. When it can't, the anchor
 * still carries source lines and the resolver falls back to those.
 */
export function plainTextOfMarkdown(src: string): string {
  return src
    .split("\n")
    .map((l) =>
      l
        .replace(/^\s{0,3}#{1,6}\s+/, "")
        .replace(/^\s*>\s?/, "")
        .replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, "")
        .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
        .replace(/(\*\*|__)(.+?)\1/g, "$2")
        .replace(/(^|[^*\w])[*_](.+?)[*_](?=[^*\w]|$)/g, "$1$2")
        .replace(/~~(.+?)~~/g, "$1")
        .replace(/`([^`]+)`/g, "$1")
        .trimEnd(),
    )
    .join("\n")
    .trim();
}

/** Body text shown locally for a thread: the opening comment plus any replies. */
export function composeBody(thread: RemoteThread): string {
  const [first, ...rest] = thread.comments;
  if (!first) return "";
  const parts = [first.body.trim()];
  for (const r of rest) parts.push(`**@${r.author}:** ${r.body.trim()}`);
  return parts.join("\n\n");
}

export interface PulledComment extends ImportedComment {
  github: GithubLink;
}

/** Turn the threads that belong to `path` into local comments anchored on `fileText`. */
export function threadsToComments(threads: RemoteThread[], path: string, fileText: string | null): PulledComment[] {
  const now = new Date().toISOString();
  const out: PulledComment[] = [];
  for (const t of threads) {
    if (t.path !== path || t.comments.length === 0) continue;
    const first = t.comments[0];
    const end = t.line ?? undefined;
    const start = t.startLine ?? end;
    const source = fileText != null && start != null && end != null ? sliceSourceLines(fileText, start, end) : "";
    const quote = plainTextOfMarkdown(source) || `@${first.author} on line ${end ?? "?"}`;
    const body = composeBody(t);
    out.push({
      body,
      status: t.isResolved ? "resolved" : "open",
      anchor: {
        quote,
        prefix: "",
        suffix: "",
        start: 0,
        end: 0,
        sourceLineStart: start,
        sourceLineEnd: end,
      },
      baseline:
        fileText != null
          ? {
              docHash: hashSource(fileText),
              sourceText: source || quote,
              lineStart: start,
              lineEnd: end,
              capturedAt: now,
            }
          : undefined,
      github: {
        commentId: first.databaseId,
        nodeId: first.nodeId,
        threadId: t.id,
        url: first.url,
        author: first.author,
        remoteResolved: t.isResolved,
        remoteBody: body,
        syncedAt: now,
      },
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Pushing local comments
// ---------------------------------------------------------------------------

interface ReviewCommentInput {
  path: string;
  line: number;
  start_line?: number;
  side: "RIGHT";
  start_side?: "RIGHT";
  body: string;
}

/** What a local comment says once it lands on GitHub. */
export function bodyForGithub(c: Comment): string {
  const note = c.body.trim() || "_(no note)_";
  if (c.anchor.part) {
    return `**Diagram ${c.anchor.part.kind} “${c.anchor.quote}”**\n\n${note}\n\n<sub>via hyper-markdown</sub>`;
  }
  return `${note}\n\n<sub>via hyper-markdown</sub>`;
}

interface CreatedComment {
  id: number;
  node_id: string;
  html_url: string;
  body: string;
  line: number | null;
  original_line: number | null;
  user: { login: string };
}

export interface PushResult {
  /** Local comment id → its new GitHub link. */
  linked: Map<string, GithubLink>;
  /** Comments that could not be placed inline and went into one summary comment. */
  summarized: string[];
}

function toLink(created: CreatedComment, body: string, now: string): GithubLink {
  return {
    commentId: created.id,
    nodeId: created.node_id,
    url: created.html_url,
    author: created.user.login,
    remoteResolved: false,
    remoteBody: body,
    syncedAt: now,
  };
}

/**
 * Post local comments as a single PR review. GitHub only accepts inline
 * comments on lines that are part of the diff; anything it rejects is posted
 * once more as a regular PR comment carrying permalinks, so nothing is lost.
 */
export async function pushComments(pr: GithubPr, headSha: string, comments: Comment[]): Promise<PushResult> {
  const now = new Date().toISOString();
  const linked = new Map<string, GithubLink>();
  const summarized: string[] = [];
  const base = `/repos/${pr.owner}/${pr.repo}`;

  const inline: { comment: Comment; input: ReviewCommentInput }[] = [];
  const unplaced: Comment[] = [];
  for (const c of comments) {
    const end = c.anchor.sourceLineEnd ?? c.anchor.sourceLineStart;
    const start = c.anchor.sourceLineStart ?? end;
    if (start == null || end == null) {
      unplaced.push(c);
      continue;
    }
    const input: ReviewCommentInput = { path: pr.path, line: end, side: "RIGHT", body: bodyForGithub(c) };
    if (start !== end) {
      input.start_line = start;
      input.start_side = "RIGHT";
    }
    inline.push({ comment: c, input });
  }

  // One review for everything that can be placed inline.
  let batchOk = false;
  if (inline.length) {
    try {
      const review = await api<{ id: number }>("POST", `${base}/pulls/${pr.number}/reviews`, {
        commit_id: headSha,
        event: "COMMENT",
        body: `Review from hyper-markdown on \`${pr.path}\``,
        comments: inline.map((i) => i.input),
      });
      const created = await api<CreatedComment[]>(
        "GET",
        `${base}/pulls/${pr.number}/reviews/${review.id}/comments?per_page=100`,
      );
      const pool = [...created];
      for (const { comment, input } of inline) {
        const idx = pool.findIndex((c) => c.body === input.body && (c.line ?? c.original_line) === input.line);
        if (idx === -1) continue;
        linked.set(comment.id, toLink(pool[idx], input.body, now));
        pool.splice(idx, 1);
      }
      batchOk = true;
    } catch (e) {
      if (!(e instanceof GithubError && e.status === 422)) throw e;
    }
  }

  // The batch was rejected (a line outside the diff): place each one alone so
  // the good ones still land inline.
  if (!batchOk) {
    for (const { comment, input } of inline) {
      try {
        const created = await api<CreatedComment>("POST", `${base}/pulls/${pr.number}/comments`, {
          commit_id: headSha,
          ...input,
        });
        linked.set(comment.id, toLink(created, input.body, now));
      } catch (e) {
        if (!(e instanceof GithubError && e.status === 422)) throw e;
        unplaced.push(comment);
      }
    }
  }

  if (unplaced.length) {
    const lines = unplaced.map((c) => {
      const s = c.anchor.sourceLineStart;
      const e = c.anchor.sourceLineEnd ?? s;
      const where =
        s != null
          ? `[\`${pr.path}\` L${s}${e && e !== s ? `–L${e}` : ""}](https://github.com/${pr.owner}/${pr.repo}/blob/${headSha}/${pr.path}#L${s}${e && e !== s ? `-L${e}` : ""})`
          : `\`${pr.path}\``;
      const quote = (c.anchor.part ? c.baseline?.sourceText : c.anchor.quote) ?? c.anchor.quote;
      return `#### ${where}\n\n${quote
        .split("\n")
        .map((l) => `> ${l}`)
        .join("\n")}\n\n${bodyForGithub(c)}`;
    });
    await api("POST", `${base}/issues/${pr.number}/comments`, {
      body: `Comments from hyper-markdown on lines outside the diff:\n\n${lines.join("\n\n---\n\n")}`,
    });
    summarized.push(...unplaced.map((c) => c.id));
  }

  return { linked, summarized };
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

export async function setThreadResolved(threadId: string, resolved: boolean): Promise<void> {
  const op = resolved ? "resolveReviewThread" : "unresolveReviewThread";
  await graphql(`mutation($id:ID!){ ${op}(input:{threadId:$id}){ thread { id isResolved } } }`, { id: threadId });
}
