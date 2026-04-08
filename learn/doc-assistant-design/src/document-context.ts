import fs from "node:fs/promises";
import path from "node:path";
import type { DocSearchHit } from "./protocol/index.js";

export const DOCUMENT_CONTEXT_REQUEST_START = "DOCUMENT_CONTEXT_REQUEST_START";
export const DOCUMENT_CONTEXT_REQUEST_END = "DOCUMENT_CONTEXT_REQUEST_END";

const DEFAULT_EXPANSION_PADDING_LINES = 36;
const MAX_EXPANSION_LINES = 120;

export type ProviderDocumentContextRequest = {
  path: string;
  startLine?: number;
  endLine?: number;
  reason?: string;
};

export type ProviderExpandedDocumentContext = {
  path: string;
  startLine: number;
  endLine: number;
  reason?: string;
  content: string;
  matchedRanges: Array<{ startLine: number; endLine: number }>;
};

function requestBlock(text: string): string | undefined {
  const start = text.indexOf(DOCUMENT_CONTEXT_REQUEST_START);
  if (start === -1) {
    return undefined;
  }
  const end = text.indexOf(
    DOCUMENT_CONTEXT_REQUEST_END,
    start + DOCUMENT_CONTEXT_REQUEST_START.length,
  );
  if (end === -1) {
    return undefined;
  }
  return text.slice(start + DOCUMENT_CONTEXT_REQUEST_START.length, end).trim();
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function dedupeHitsByRange(hits: DocSearchHit[]): DocSearchHit[] {
  const seen = new Set<string>();
  return hits.filter((hit) => {
    const key = `${hit.path}:${hit.startLine}:${hit.endLine}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export function parseProviderDocumentContextRequest(
  text: string | undefined,
): ProviderDocumentContextRequest | undefined {
  const block = requestBlock(text ?? "");
  if (!block) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(block) as ProviderDocumentContextRequest;
    if (!parsed || typeof parsed.path !== "string" || parsed.path.trim().length === 0) {
      return undefined;
    }
    return {
      path: parsed.path.trim(),
      startLine:
        typeof parsed.startLine === "number" && Number.isFinite(parsed.startLine)
          ? Math.trunc(parsed.startLine)
          : undefined,
      endLine:
        typeof parsed.endLine === "number" && Number.isFinite(parsed.endLine)
          ? Math.trunc(parsed.endLine)
          : undefined,
      reason: typeof parsed.reason === "string" ? parsed.reason.trim() : undefined,
    };
  } catch {
    return undefined;
  }
}

export function renderProviderDocumentAccessGuidance(params: {
  hits: DocSearchHit[];
  expandedContexts?: ProviderExpandedDocumentContext[];
}): string {
  const hits = dedupeHitsByRange(params.hits);
  if (hits.length === 0) {
    return "";
  }
  const byPath = new Map<
    string,
    {
      headings: string[];
      ranges: Array<{ startLine: number; endLine: number }>;
    }
  >();
  for (const hit of hits) {
    const current = byPath.get(hit.path) ?? { headings: [], ranges: [] };
    if (hit.heading && !current.headings.includes(hit.heading)) {
      current.headings.push(hit.heading);
    }
    current.ranges.push({ startLine: hit.startLine, endLine: hit.endLine });
    byPath.set(hit.path, current);
  }
  const expandedBlocks =
    params.expandedContexts && params.expandedContexts.length > 0
      ? [
          "",
          "Expanded source context loaded from the original documents:",
          ...params.expandedContexts.map((context) => renderExpandedDocumentContext(context)),
        ]
      : [];
  return [
    "Bounded source-document access:",
    "Available documents from the current retrieval set:",
    ...Array.from(byPath.entries()).map(([docPath, value]) => {
      const ranges = value.ranges
        .map((range) => `${range.startLine}-${range.endLine}`)
        .slice(0, 4)
        .join(", ");
      const heading = value.headings[0] ? ` | heading: ${value.headings[0]}` : "";
      return `- ${docPath} | matched lines: ${ranges}${heading}`;
    }),
    "",
    "If the current evidence is insufficient, you may request more original-document context from one listed path.",
    "Reply with ONLY this block and no final answer:",
    DOCUMENT_CONTEXT_REQUEST_START,
    '{"path":"docs/example.md","startLine":20,"endLine":90,"reason":"Need the surrounding steps and caveats"}',
    DOCUMENT_CONTEXT_REQUEST_END,
    "Rules:",
    "- Request at most one document per reply.",
    "- Only request a listed path.",
    `- Keep the requested range to at most ${MAX_EXPANSION_LINES} lines.`,
    "- After extra context is provided, answer normally.",
    ...expandedBlocks,
  ].join("\n");
}

export function renderExpandedDocumentContext(context: ProviderExpandedDocumentContext): string {
  const reason = context.reason ? `Reason: ${context.reason}\n` : "";
  return [
    `Document: ${context.path}`,
    `Lines: ${context.startLine}-${context.endLine}`,
    reason.trimEnd(),
    "Content:",
    context.content,
  ]
    .filter(Boolean)
    .join("\n");
}

function buildAllowedPathSet(hits: DocSearchHit[]): Set<string> {
  return new Set(hits.map((hit) => hit.path));
}

function safeResolveDocumentPath(docsRoot: string, relativeDocPath: string): string | undefined {
  const docsParent = path.resolve(path.dirname(docsRoot));
  const resolved = path.resolve(docsParent, relativeDocPath);
  if (resolved === docsParent || !resolved.startsWith(`${docsParent}${path.sep}`)) {
    return undefined;
  }
  return resolved;
}

export async function fulfillProviderDocumentContextRequest(params: {
  request: ProviderDocumentContextRequest;
  hits: DocSearchHit[];
  docsRoot?: string;
}): Promise<ProviderExpandedDocumentContext | undefined> {
  if (!params.docsRoot) {
    return undefined;
  }
  const allowedPaths = buildAllowedPathSet(params.hits);
  if (!allowedPaths.has(params.request.path)) {
    return undefined;
  }
  const resolvedPath = safeResolveDocumentPath(params.docsRoot, params.request.path);
  if (!resolvedPath) {
    return undefined;
  }
  const matchingHits = dedupeHitsByRange(
    params.hits.filter((hit) => hit.path === params.request.path),
  );
  if (matchingHits.length === 0) {
    return undefined;
  }
  const rawText = await fs.readFile(resolvedPath, "utf-8");
  const lines = rawText.split(/\r?\n/);
  const anchor = matchingHits[0];
  let startLine = params.request.startLine ?? anchor.startLine - DEFAULT_EXPANSION_PADDING_LINES;
  let endLine = params.request.endLine ?? anchor.endLine + DEFAULT_EXPANSION_PADDING_LINES;
  startLine = clamp(startLine, 1, Math.max(lines.length, 1));
  endLine = clamp(endLine, startLine, Math.max(lines.length, startLine));
  if (endLine - startLine + 1 > MAX_EXPANSION_LINES) {
    endLine = startLine + MAX_EXPANSION_LINES - 1;
  }
  const content = lines
    .slice(startLine - 1, endLine)
    .map((line, index) => `${startLine + index} | ${line}`)
    .join("\n");
  return {
    path: params.request.path,
    startLine,
    endLine,
    reason: params.request.reason,
    content,
    matchedRanges: matchingHits.map((hit) => ({ startLine: hit.startLine, endLine: hit.endLine })),
  };
}
