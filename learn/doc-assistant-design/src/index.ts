import { pathToFileURL } from "node:url";
import { loadDocAssistantDotEnv, resolveDocAssistantDocsRootFromEnv } from "./env.js";
import { createDocAssistantServer } from "./server.js";

function parseAllowedOrigins(raw: string | undefined): string[] | undefined {
  if (!raw) {
    return undefined;
  }
  const origins = raw
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  return origins.length > 0 ? origins : undefined;
}

export * from "./server.js";
export * from "./protocol/index.js";
export * from "./doc-index.js";
export * from "./doc-search.js";
export * from "./smoke.js";
export * from "./answer-memory.js";

async function main(): Promise<void> {
  loadDocAssistantDotEnv();
  const server = await createDocAssistantServer({
    port: 8790,
    host: "127.0.0.1",
    docsRoot: resolveDocAssistantDocsRootFromEnv(),
    adminToken: process.env.DOC_ASSISTANT_ADMIN_TOKEN,
    allowedOrigins: parseAllowedOrigins(process.env.DOC_ASSISTANT_CORS_ORIGINS),
  });

  console.log("Learn Doc Assistant is running.");
  console.log(`WebSocket: ${server.url}`);
  console.log(`HTTP API:  ${server.apiBaseUrl}`);
  console.log(`Health:    http://${server.host}:${server.port}/health`);
  console.log(`UI:        ${server.uiUrl}`);
  console.log(`Embed:     ${server.embedUrl}`);
  console.log("Registered methods:");
  for (const { method, description } of server.router.listMethods()) {
    console.log(`  ${method.padEnd(28)} ${description ?? ""}`);
  }

  const shutdown = async () => {
    await server.close();
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown();
  });
  process.on("SIGTERM", () => {
    void shutdown();
  });
}

const entryArg = process.argv[1];
if (entryArg && import.meta.url === pathToFileURL(entryArg).href) {
  void main();
}
