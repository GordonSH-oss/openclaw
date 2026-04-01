import fs from "node:fs/promises";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { parseCliArgs } from "./cli.js";
import { loadDocAssistantDotEnv } from "./env.js";
import { DOC_ASSISTANT_EVAL_CASES, type DocAssistantEvalCase } from "./eval-cases.js";
import { runDocAssistantSmoke } from "./smoke.js";

type EvalCliOptions = {
  docsRoot: string;
  dataDir?: string;
  mode: "extractive" | "agent";
  baseURL?: string;
  apiKey?: string;
  model?: string;
  caseFilter?: string;
  showAnswers: boolean;
  reportFile?: string;
};

type EvalResult = {
  caseDef: DocAssistantEvalCase;
  passed: boolean;
  reasons: string[];
  retrieval: Awaited<ReturnType<typeof runDocAssistantSmoke>>["retrieval"];
  answer?: string;
  summary?: string;
};

function parseEvalArgs(argv: string[]): EvalCliOptions {
  loadDocAssistantDotEnv();
  const base = parseCliArgs(argv);
  const options: EvalCliOptions = {
    docsRoot: base.docsRoot,
    dataDir: base.dataDir,
    mode: base.mode,
    baseURL: base.baseURL,
    apiKey: base.apiKey,
    model: base.model,
    showAnswers: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--case" && next) {
      options.caseFilter = next.toLowerCase();
      index += 1;
      continue;
    }
    if (arg === "--show-answers") {
      options.showAnswers = true;
      continue;
    }
    if (arg === "--report-file" && next) {
      options.reportFile = next;
      index += 1;
    }
  }

  return options;
}

function pathMatches(path: string, suffixes: string[]): boolean {
  return suffixes.some((suffix) => path.endsWith(suffix) || path.includes(suffix));
}

function headingMatches(heading: string | undefined, keywords: string[]): boolean {
  const normalized = (heading ?? "").toLowerCase();
  return keywords.some((keyword) => normalized.includes(keyword.toLowerCase()));
}

export function evaluateRetrievalCase(params: {
  caseDef: DocAssistantEvalCase;
  retrieval: Awaited<ReturnType<typeof runDocAssistantSmoke>>["retrieval"];
}): { passed: boolean; reasons: string[] } {
  const topK = params.caseDef.topK ?? 3;
  const topHits = params.retrieval.slice(0, topK);
  const reasons: string[] = [];

  if (params.caseDef.allowNoHits) {
    if (topHits.length === 0) {
      return { passed: true, reasons: ["No hits as expected."] };
    }
    return {
      passed: false,
      reasons: [`Expected no hits, but got ${String(topHits.length)} retrieval results.`],
    };
  }

  if (params.caseDef.expectedPathSuffixes?.length) {
    const matched = topHits.some((hit) =>
      pathMatches(hit.path, params.caseDef.expectedPathSuffixes ?? []),
    );
    if (!matched) {
      reasons.push(
        `Top ${String(topK)} did not include any expected path: ${params.caseDef.expectedPathSuffixes.join(", ")}`,
      );
    }
  }

  if (params.caseDef.discouragedPathSuffixes?.length) {
    const discouraged = topHits.find((hit) =>
      pathMatches(hit.path, params.caseDef.discouragedPathSuffixes ?? []),
    );
    if (discouraged) {
      reasons.push(`Discouraged path appeared in top ${String(topK)}: ${discouraged.path}`);
    }
  }

  if (params.caseDef.expectedHeadingKeywords?.length) {
    const headingOk = topHits.some((hit) =>
      headingMatches(hit.heading, params.caseDef.expectedHeadingKeywords ?? []),
    );
    if (!headingOk) {
      reasons.push(
        `Top ${String(topK)} headings did not include keywords: ${params.caseDef.expectedHeadingKeywords.join(", ")}`,
      );
    }
  }

  return {
    passed: reasons.length === 0,
    reasons: reasons.length === 0 ? ["Retrieval expectations satisfied."] : reasons,
  };
}

export function evaluateAnswerCase(params: {
  caseDef: DocAssistantEvalCase;
  answer: string;
  summary: string;
}): { passed: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const normalizedAnswer = params.answer.toLowerCase();
  const normalizedSummary = params.summary.toLowerCase();

  if (params.caseDef.expectedSummaryKeywords?.length) {
    for (const keyword of params.caseDef.expectedSummaryKeywords) {
      if (!normalizedSummary.includes(keyword.toLowerCase())) {
        reasons.push(`Summary did not include expected keyword: ${keyword}`);
      }
    }
  }

  if (params.caseDef.expectedAnswerKeywords?.length) {
    for (const keyword of params.caseDef.expectedAnswerKeywords) {
      if (!normalizedAnswer.includes(keyword.toLowerCase())) {
        reasons.push(`Answer did not include expected keyword: ${keyword}`);
      }
    }
  }

  if (params.caseDef.discouragedAnswerKeywords?.length) {
    for (const keyword of params.caseDef.discouragedAnswerKeywords) {
      if (normalizedAnswer.includes(keyword.toLowerCase())) {
        reasons.push(`Answer included discouraged keyword: ${keyword}`);
      }
    }
  }

  return {
    passed: reasons.length === 0,
    reasons: reasons.length === 0 ? ["Answer expectations satisfied."] : reasons,
  };
}

function printUsage(): void {
  console.log(
    [
      "Usage:",
      "  npm run eval -- --docs-root /path/to/docs",
      "  npm run eval -- --docs-root /path/to/docs --mode agent --show-answers",
      "  npm run eval -- --docs-root /path/to/docs --case ios-1to1-call",
      "  npm run eval -- --docs-root /path/to/docs --report-file ./eval-report.json",
      "",
      "Flags:",
      "  --case <id-substring>   Run only matching cases",
      "  --show-answers          Print final answers in addition to retrieval results",
      "  --report-file <path>    Save the full evaluation report as JSON",
      "  --mode extractive|agent",
    ].join("\n"),
  );
}

async function runEvalCase(
  caseDef: DocAssistantEvalCase,
  options: EvalCliOptions,
): Promise<EvalResult> {
  const smoke = await runDocAssistantSmoke({
    docsRoot: options.docsRoot,
    question: caseDef.question,
    turns: caseDef.turns,
    dataDir: options.dataDir,
    mode: options.mode,
    model: options.model,
    openAICompatible:
      options.mode === "agent" && options.baseURL && options.apiKey
        ? {
            baseURL: options.baseURL,
            apiKey: options.apiKey,
            model: options.model,
          }
        : undefined,
  });
  const verdict = evaluateRetrievalCase({
    caseDef,
    retrieval: smoke.retrieval,
  });
  const answerVerdict = evaluateAnswerCase({
    caseDef,
    answer: smoke.answer,
    summary: smoke.summary,
  });
  return {
    caseDef,
    passed: verdict.passed && answerVerdict.passed,
    reasons: [...verdict.reasons, ...answerVerdict.reasons],
    retrieval: smoke.retrieval,
    answer: smoke.answer,
    summary: smoke.summary,
  };
}

async function main(): Promise<void> {
  const options = parseEvalArgs(process.argv.slice(2));
  if (!options.docsRoot) {
    printUsage();
    process.exitCode = 1;
    return;
  }
  if (options.mode === "agent" && (!options.baseURL || !options.apiKey)) {
    console.error(
      "Agent eval requires DOC_ASSISTANT_BASE_URL and DOC_ASSISTANT_API_KEY, or explicit flags.",
    );
    process.exitCode = 1;
    return;
  }

  const selectedCases = DOC_ASSISTANT_EVAL_CASES.filter((caseDef) =>
    options.caseFilter
      ? caseDef.id.toLowerCase().includes(options.caseFilter) ||
        caseDef.title.toLowerCase().includes(options.caseFilter)
      : true,
  );
  if (selectedCases.length === 0) {
    console.error(`No cases matched filter: ${options.caseFilter}`);
    process.exitCode = 1;
    return;
  }

  const results: EvalResult[] = [];
  for (const caseDef of selectedCases) {
    results.push(await runEvalCase(caseDef, options));
  }

  let passedCount = 0;
  for (const result of results) {
    if (result.passed) {
      passedCount += 1;
    }
    console.log(
      `${result.passed ? "PASS" : "FAIL"} ${result.caseDef.id} - ${result.caseDef.title}`,
    );
    console.log(
      `Question: ${
        result.caseDef.turns && result.caseDef.turns.length > 0
          ? result.caseDef.turns.join(" -> ")
          : result.caseDef.question
      }`,
    );
    if (result.caseDef.notes) {
      console.log(`Note: ${result.caseDef.notes}`);
    }
    for (const reason of result.reasons) {
      console.log(`  - ${reason}`);
    }
    console.log("  Retrieval:");
    for (const [index, hit] of result.retrieval.slice(0, result.caseDef.topK ?? 3).entries()) {
      console.log(
        `    ${String(index + 1)}. ${hit.path}:${hit.startLine}-${hit.endLine} score=${String(hit.score)}${hit.heading ? ` heading=${hit.heading}` : ""}`,
      );
    }
    if (options.showAnswers) {
      console.log("  Answer:");
      console.log(result.answer ?? "");
      console.log(`  Summary: ${result.summary ?? ""}`);
    }
    console.log("");
  }

  console.log(`Passed ${String(passedCount)}/${String(results.length)} evaluation cases.`);
  if (options.reportFile) {
    await fs.writeFile(
      options.reportFile,
      JSON.stringify(
        {
          mode: options.mode,
          docsRoot: options.docsRoot,
          passedCount,
          total: results.length,
          generatedAt: new Date().toISOString(),
          results,
        },
        null,
        2,
      ),
      "utf-8",
    );
    console.log(`Saved evaluation report to ${options.reportFile}`);
  }
  if (passedCount !== results.length) {
    process.exitCode = 1;
  }
}

const entryArg = process.argv[1];
if (entryArg && import.meta.url === pathToFileURL(entryArg).href) {
  void main();
}
