import type { DocSearchHit } from "./protocol/index.js";

export type AnswerLanguage = "zh" | "en";

function countMatches(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length ?? 0;
}

function looksEnglish(text: string): boolean {
  return countMatches(text, /[A-Za-z]{3,}/g) > 0;
}

export function detectAnswerLanguage(
  question: string,
  hits: Array<Pick<DocSearchHit, "path" | "heading" | "snippet" | "text">>,
): AnswerLanguage {
  const questionText = question.trim();
  if (countMatches(questionText, /[\u4e00-\u9fff]/g) > 0) {
    return "zh";
  }
  if (!looksEnglish(questionText)) {
    return "zh";
  }

  const evidenceSample = [
    questionText,
    ...hits.slice(0, 4).map((hit) =>
      [hit.path, hit.heading ?? "", hit.snippet, hit.text.slice(0, 180)].join(" "),
    ),
  ].join(" ");
  const latinCount = countMatches(evidenceSample, /[A-Za-z]/g);
  const cjkCount = countMatches(evidenceSample, /[\u4e00-\u9fff]/g);
  return latinCount >= Math.max(12, cjkCount * 4) ? "en" : "zh";
}
