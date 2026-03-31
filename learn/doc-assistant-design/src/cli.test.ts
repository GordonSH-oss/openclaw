import test from "node:test";
import assert from "node:assert/strict";
import process from "node:process";
import { parseCliArgs } from "./cli.js";

test("parseCliArgs uses DOC_ASSISTANT_DOCS_ROOT when --docs-root is omitted", () => {
  const previous = process.env.DOC_ASSISTANT_DOCS_ROOT;
  process.env.DOC_ASSISTANT_DOCS_ROOT = "/tmp/doc-assistant-env-docs";

  try {
    const parsed = parseCliArgs(["--question", "How do I configure push settings?"]);
    assert.equal(parsed.docsRoot, "/tmp/doc-assistant-env-docs");
  } finally {
    if (previous === undefined) {
      delete process.env.DOC_ASSISTANT_DOCS_ROOT;
    } else {
      process.env.DOC_ASSISTANT_DOCS_ROOT = previous;
    }
  }
});

test("parseCliArgs lets --docs-root override DOC_ASSISTANT_DOCS_ROOT", () => {
  const previous = process.env.DOC_ASSISTANT_DOCS_ROOT;
  process.env.DOC_ASSISTANT_DOCS_ROOT = "/tmp/doc-assistant-env-docs";

  try {
    const parsed = parseCliArgs([
      "--docs-root",
      "/tmp/doc-assistant-flag-docs",
      "--question",
      "How do I configure push settings?",
    ]);
    assert.equal(parsed.docsRoot, "/tmp/doc-assistant-flag-docs");
  } finally {
    if (previous === undefined) {
      delete process.env.DOC_ASSISTANT_DOCS_ROOT;
    } else {
      process.env.DOC_ASSISTANT_DOCS_ROOT = previous;
    }
  }
});
