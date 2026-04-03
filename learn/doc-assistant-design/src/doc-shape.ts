import type { DocSearchHit } from "./protocol/index.js";
import { PLATFORM_TOKENS, normalizeSearchText } from "./search-text.js";

export type DocTier = "primary" | "partial";
export type DocSearchDocShape =
  | "quickstart_step"
  | "specialized_task"
  | "overview"
  | "generic_reference";

export function detectDocShape(
  hit: Pick<DocSearchHit, "path" | "heading" | "text">,
): DocSearchDocShape {
  // Shape is a coarse retrieval hint, not a strict taxonomy. We bias ranking
  // toward quickstart steps for onboarding flows and specialized task docs for
  // API questions without making the path structure a hard requirement.
  const normalizedPath = normalizeSearchText(hit.path);
  const normalizedHeading = normalizeSearchText(hit.heading ?? "");
  const normalizedBody = normalizeSearchText(hit.text.slice(0, 500));
  const combined = `${normalizedPath} ${normalizedHeading}`.trim();
  const quickstartPage =
    normalizedPath.includes("quickstart") ||
    normalizedPath.includes("getting started") ||
    normalizedPath.includes("get started") ||
    normalizedHeading.includes("quickstart") ||
    normalizedHeading.includes("getting started") ||
    normalizedHeading.includes("get started");
  const stepHeading =
    /\bstep\s+\d+\b/.test(normalizedHeading) ||
    normalizedHeading.startsWith("step ") ||
    normalizedHeading.includes("send your first message") ||
    normalizedHeading.includes("send a message");
  const specializedPath =
    normalizedPath.includes("/message/send") ||
    normalizedPath.includes("/connection/connect") ||
    normalizedPath.includes("/community channels/creating channel") ||
    normalizedPath.includes("/community-channels/creating-channel") ||
    normalizedPath.includes("/group channels/") ||
    normalizedPath.includes("/group-channels/") ||
    normalizedPath.includes("/direct system channels/") ||
    normalizedPath.includes("/direct-system-channels/");
  const specializedHeading =
    normalizedHeading.includes("send a text message") ||
    normalizedHeading.includes("send a regular message") ||
    normalizedHeading.includes("send an image message") ||
    normalizedHeading.includes("send a file message") ||
    normalizedHeading.includes("send a voice message") ||
    normalizedHeading.includes("send a media message") ||
    normalizedHeading.includes("send a targeted message") ||
    normalizedHeading.includes("connect") ||
    normalizedHeading.includes("create a group") ||
    normalizedHeading.includes("creating community channels");

  if (
    combined.includes("overview") ||
    combined.includes("/about") ||
    normalizedHeading.includes("about ") ||
    normalizedHeading.includes("glossary")
  ) {
    return "overview";
  }
  if (quickstartPage && (stepHeading || normalizedBody.includes("for details"))) {
    return "quickstart_step";
  }
  if (specializedPath || specializedHeading) {
    return "specialized_task";
  }
  return "generic_reference";
}

export function detectDocTier(pathText: string): DocTier {
  if (pathText.includes("/partials/")) {
    return "partial";
  }
  return "primary";
}

export function getTierWeight(tier: DocTier): number {
  if (tier === "primary") {
    return 3;
  }
  return 2;
}

export function getBasenameStem(pathText: string): string {
  // Basename comparisons help dedupe partials and platform variants that
  // represent the same conceptual page.
  const filename = pathText.split("/").at(-1) ?? pathText;
  return normalizeSearchText(filename.replace(/\.(md|mdx)$/i, ""));
}

export function getPathPlatforms(pathText: string): string[] {
  return PLATFORM_TOKENS.filter((token) => pathText.includes(token));
}

export function countMatchingPlatforms(pathPlatforms: string[], queryPlatforms: string[]): number {
  if (queryPlatforms.length === 0) {
    return 0;
  }
  const querySet = new Set(queryPlatforms);
  let matches = 0;
  for (const platform of pathPlatforms) {
    if (querySet.has(platform)) {
      matches += 1;
    }
  }
  return matches;
}
