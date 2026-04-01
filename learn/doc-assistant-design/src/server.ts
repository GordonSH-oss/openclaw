import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import process from "node:process";
import type { OpenAICompatibleConfig } from "./protocol/index.js";
import { DEFAULT_DOC_ASSISTANT_AGENT_MODEL } from "./openai-compatible.js";
import { createDocAssistantRuntimeState } from "./server-runtime-state.js";
import { createDocAssistantRouter } from "./server-methods.js";
import { attachDocAssistantWsHandlers } from "./server-ws-runtime.js";
import { serveDocAssistantApi } from "./http-api.js";
import { serveDocAssistantUi } from "./http-ui.js";
import { DOC_ASSISTANT_MARKETING_VERSION, DOC_ASSISTANT_PACKAGE_VERSION } from "./version.js";
import { loadDocAssistantDotEnv, resolveDocAssistantDocsRootFromEnv } from "./env.js";

export type DocAssistantServerConfig = {
  port?: number;
  host?: string;
  listen?: boolean;
  docsRoot?: string;
  dataDir?: string;
  defaultMode?: "extractive" | "agent";
  adminToken?: string;
  defaultAgentConfig?: {
    backend?: "embedded" | "cli";
    provider?: string;
    model?: string;
    openAICompatible?: OpenAICompatibleConfig;
  };
  allowedOrigins?: string[];
};

const DEFAULT_ALLOWED_ORIGINS = ["http://localhost:3000"];

function resolveAllowedOrigins(allowedOrigins: string[] | undefined): string[] {
  return Array.from(new Set([...DEFAULT_ALLOWED_ORIGINS, ...(allowedOrigins ?? [])]));
}

function resolveDefaultAgentConfig(
  config: DocAssistantServerConfig,
): DocAssistantServerConfig["defaultAgentConfig"] {
  if (config.defaultAgentConfig) {
    return config.defaultAgentConfig;
  }

  const baseURL = process.env.DOC_ASSISTANT_BASE_URL?.trim();
  const apiKey = process.env.DOC_ASSISTANT_API_KEY?.trim();
  const model = process.env.DOC_ASSISTANT_MODEL?.trim() || DEFAULT_DOC_ASSISTANT_AGENT_MODEL;

  if (!baseURL || !apiKey) {
    return undefined;
  }

  return {
    provider: "openai-compatible",
    model,
    openAICompatible: {
      baseURL,
      apiKey,
      model,
    },
  };
}

export async function createDocAssistantServer(config: DocAssistantServerConfig = {}) {
  loadDocAssistantDotEnv();
  const port = config.port ?? 8790;
  const host = config.host ?? "127.0.0.1";
  const shouldListen = config.listen ?? true;
  const docsRoot = config.docsRoot ?? resolveDocAssistantDocsRootFromEnv();
  const defaultMode = config.defaultMode ?? "extractive";

  const state = createDocAssistantRuntimeState({
    version: DOC_ASSISTANT_MARKETING_VERSION,
    packageVersion: DOC_ASSISTANT_PACKAGE_VERSION,
    docsRoot,
    dataDir: config.dataDir,
    defaultMode,
    adminToken: config.adminToken,
    defaultAgentConfig: resolveDefaultAgentConfig(config),
  });
  const router = createDocAssistantRouter();
  const allowedOrigins = resolveAllowedOrigins(config.allowedOrigins);

  const httpServer = createServer(async (req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          status: "ok",
          version: state.config.version,
          packageVersion: state.config.packageVersion,
          docsRoot,
          apiPath: "/api/doc-assistant",
          uiPath: "/ui",
          embedPath: "/embed",
          connections: state.broadcaster.getConnCount(),
          activeRuns: state.runs.activeRuns.size,
          uptime: process.uptime(),
        }),
      );
      return;
    }
    if (
      await serveDocAssistantApi({
        req,
        res,
        router,
        state,
        allowedOrigins,
      })
    ) {
      return;
    }
    if (await serveDocAssistantUi(req, res)) {
      return;
    }
    res.writeHead(404);
    res.end("Not Found");
  });
  const wss = attachDocAssistantWsHandlers({
    httpServer,
    state,
    router,
  });

  let resolvedPort = port;
  if (shouldListen) {
    await new Promise<void>((resolve) => {
      httpServer.listen(port, host, () => resolve());
    });
    const address = httpServer.address() as AddressInfo;
    resolvedPort = address.port;
  }

  const url = `ws://${host}:${resolvedPort}`;
  const httpBaseUrl = `http://${host}:${resolvedPort}`;

  return {
    state,
    router,
    wss,
    host,
    port: resolvedPort,
    version: state.config.version,
    packageVersion: state.config.packageVersion,
    url,
    httpBaseUrl,
    apiBaseUrl: `${httpBaseUrl}/api/doc-assistant`,
    uiUrl: `${httpBaseUrl}/ui`,
    embedUrl: `${httpBaseUrl}/embed`,
    docsRoot,
    async close() {
      wss.close();
      if (!shouldListen) {
        return;
      }
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}
