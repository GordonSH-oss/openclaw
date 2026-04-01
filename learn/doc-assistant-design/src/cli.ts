import process from "node:process";
import { pathToFileURL } from "node:url";
import { loadDocAssistantDotEnv, resolveDocAssistantDocsRootFromEnv } from "./env.js";
import { runDocAssistantSmoke } from "./smoke.js";

export type CliOptions = {
  docsRoot: string;
  question?: string;
  dataDir?: string;
  mode: "extractive" | "agent";
  baseURL?: string;
  apiKey?: string;
  model?: string;
};

export function parseCliArgs(argv: string[]): CliOptions {
  loadDocAssistantDotEnv();
  const options: CliOptions = {
    docsRoot: resolveDocAssistantDocsRootFromEnv(),
    mode: "extractive",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--docs-root" && next) {
      options.docsRoot = next;
      index += 1;
      continue;
    }
    if (arg === "--question" && next) {
      options.question = next;
      index += 1;
      continue;
    }
    if (arg === "--data-dir" && next) {
      options.dataDir = next;
      index += 1;
      continue;
    }
    if (arg === "--mode" && next && (next === "extractive" || next === "agent")) {
      options.mode = next;
      index += 1;
      continue;
    }
    if (arg === "--base-url" && next) {
      options.baseURL = next;
      index += 1;
      continue;
    }
    if (arg === "--api-key" && next) {
      options.apiKey = next;
      index += 1;
      continue;
    }
    if (arg === "--model" && next) {
      options.model = next;
      index += 1;
    }
  }

  options.baseURL ??= process.env.DOC_ASSISTANT_BASE_URL;
  options.apiKey ??= process.env.DOC_ASSISTANT_API_KEY;
  options.model ??= process.env.DOC_ASSISTANT_MODEL;

  return options;
}

export function printCliUsage(): void {
  console.log(
    [
      "Usage:",
      '  npm run ask -- --question "How do I configure push settings?"',
      '  npm run ask -- --docs-root /path/to/docs --mode agent --question "How do I start a 1-to-1 call?"',
      '  npm run ask -- --docs-root /path/to/docs --mode agent --base-url https://host/v1 --api-key sk-... --model gpt-5.4 --question "How do I start a 1-to-1 call?"',
      "",
      "Auto-loaded .env:",
      "  learn/doc-assistant-design/.env",
      "",
      "Supported environment variables:",
      "  DOC_ASSISTANT_DOCS_ROOT",
      "  DOC_ASSISTANT_BASE_URL",
      "  DOC_ASSISTANT_API_KEY",
      "  DOC_ASSISTANT_MODEL",
    ].join("\n"),
  );
}

async function main(): Promise<void> {
  const options = parseCliArgs(process.argv.slice(2));
  if (!options.question) {
    printCliUsage();
    process.exitCode = 1;
    return;
  }
  if (options.mode === "agent" && (!options.baseURL || !options.apiKey)) {
    console.error(
      "Agent mode requires --base-url and --api-key, or DOC_ASSISTANT_BASE_URL / DOC_ASSISTANT_API_KEY.",
    );
    process.exitCode = 1;
    return;
  }

  const result = await runDocAssistantSmoke({
    docsRoot: options.docsRoot,
    question: options.question,
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

  console.log(`Question: ${result.question}`);
  console.log("");
  console.log("Top Retrieval:");
  for (const [index, hit] of result.retrieval.entries()) {
    console.log(
      `${String(index + 1)}. ${hit.path}:${hit.startLine}-${hit.endLine} score=${String(hit.score)}${hit.heading ? ` heading=${hit.heading}` : ""}`,
    );
  }
  console.log("");
  console.log("Answer:");
  console.log(result.answer);
  console.log("");
  console.log(`Summary: ${result.summary}`);
  if (result.selectedProvider || result.selectedModel) {
    console.log(
      `Model: ${result.selectedProvider ?? "unknown"}/${result.selectedModel ?? "unknown"}`,
    );
  }
}

const entryArg = process.argv[1];
if (entryArg && import.meta.url === pathToFileURL(entryArg).href) {
  void main();
}
