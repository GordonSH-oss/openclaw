import { getActiveLearningPluginRegistry } from "../../../plugin-design/src/index.js";
import {
  appendLearningDailyMemoryEntry,
  loadLearningTranscript,
  readLearningMemoryFile,
  searchLearningMemory,
} from "../../../session-memory-design/src/index.js";
import type { LearningTranscriptMessage } from "../types.js";

export type ToolCall = {
  toolName:
    | "math"
    | "transcript_lookup"
    | "gateway_stub"
    | "memory_search"
    | "memory_get"
    | "memory_write";
  input: Record<string, unknown>;
};

/**
 * learning 版故意用“规则识别 tool call”而不是接真实模型 SDK。
 *
 * 这样你可以把注意力放在 tool runtime 自身：
 * - tool call 如何被识别
 * - tool use / tool result 如何写进 transcript
 * - tool 的副作用如何影响长期记忆
 */
export function detectToolCall(message: string): ToolCall | null {
  const mathMatch = message.match(/(?:calc|计算)[:：]?\s*([0-9+\-*/().\s]+)/i);
  if (mathMatch) {
    return {
      toolName: "math",
      input: { expression: mathMatch[1]?.trim() ?? "" },
    };
  }
  if (message.includes("回顾 transcript") || message.includes("查看历史")) {
    return {
      toolName: "transcript_lookup",
      input: { limit: 4 },
    };
  }
  const gatewayMethodMatch = message.match(/(gateway(?:\.[a-z0-9_-]+)+)/i);
  if (message.includes("gateway status") || gatewayMethodMatch) {
    return {
      toolName: "gateway_stub",
      input: { method: gatewayMethodMatch?.[1] ?? "gateway.status" },
    };
  }
  const memorySearchMatch = message.match(/(?:memory_search|搜索记忆|查找记忆)[:：]?\s*([\s\S]+)/i);
  if (memorySearchMatch) {
    return {
      toolName: "memory_search",
      input: { query: memorySearchMatch[1]?.trim() ?? "" },
    };
  }
  const memoryGetMatch = message.match(/(?:memory_get|读取记忆|查看\s*memory)[:：]?\s*([^\n]+)?/i);
  if (memoryGetMatch) {
    return {
      toolName: "memory_get",
      input: { path: memoryGetMatch[1]?.trim() || "MEMORY.md" },
    };
  }
  const memoryWriteMatch = message.match(/(?:remember|记住|写入记忆|存到记忆)[:：]?\s*([\s\S]+)/i);
  if (memoryWriteMatch) {
    return {
      toolName: "memory_write",
      input: { note: memoryWriteMatch[1]?.trim() ?? "" },
    };
  }
  return null;
}

function stringInput(input: Record<string, unknown>, key: string, fallback = ""): string {
  const value = input[key];
  return typeof value === "string" ? value : fallback;
}

function numberInput(input: Record<string, unknown>, key: string, fallback: number): number {
  const value = input[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function safeEvaluateExpression(raw: string): number {
  if (!/^[0-9+\-*/().\s]+$/.test(raw)) {
    throw new Error("表达式只允许数字和 + - * / ()");
  }
  const expression = raw.replace(/\s+/g, "");
  let index = 0;

  const readPrimary = (): number => {
    const char = expression[index];
    if (char === "(") {
      index += 1;
      const value = readExpression();
      if (expression[index] !== ")") {
        throw new Error("括号未闭合");
      }
      index += 1;
      return value;
    }
    if (char === "+" || char === "-") {
      index += 1;
      const value = readPrimary();
      return char === "-" ? -value : value;
    }
    const match = expression.slice(index).match(/^\d+(?:\.\d+)?/);
    if (!match?.[0]) {
      throw new Error("表达式格式不正确");
    }
    index += match[0].length;
    return Number(match[0]);
  };

  const readTerm = (): number => {
    let value = readPrimary();
    while (expression[index] === "*" || expression[index] === "/") {
      const operator = expression[index];
      index += 1;
      const right = readPrimary();
      value = operator === "*" ? value * right : value / right;
    }
    return value;
  };

  const readExpression = (): number => {
    let value = readTerm();
    while (expression[index] === "+" || expression[index] === "-") {
      const operator = expression[index];
      index += 1;
      const right = readTerm();
      value = operator === "+" ? value + right : value - right;
    }
    return value;
  };

  const result = readExpression();
  if (index !== expression.length || !Number.isFinite(result)) {
    throw new Error("表达式格式不正确");
  }
  return result;
}

function renderTranscriptPreview(messages: LearningTranscriptMessage[]): string {
  return messages
    .map((message) => {
      const text =
        typeof message.content === "string"
          ? message.content
          : message.content
              .map((part) =>
                part.type === "text"
                  ? part.text
                  : part.type === "tool_use"
                    ? `[tool_use:${part.toolName}]`
                    : `[tool_result:${part.content}]`,
              )
              .join(" ");
      return `${message.role}: ${text}`;
    })
    .join("\n");
}

export async function executeTool(params: {
  call: ToolCall;
  sessionId: string;
  dataDir?: string;
  workspaceDir?: string;
}): Promise<string> {
  let pluginRegistry: ReturnType<typeof getActiveLearningPluginRegistry> | null = null;
  try {
    pluginRegistry = getActiveLearningPluginRegistry();
  } catch {
    pluginRegistry = null;
  }
  if (params.call.toolName === "math") {
    const expression = stringInput(params.call.input, "expression");
    const result = safeEvaluateExpression(expression);
    return `${expression} = ${result}`;
  }
  if (params.call.toolName === "transcript_lookup") {
    const limit = numberInput(params.call.input, "limit", 4);
    const transcript = await loadLearningTranscript(params.sessionId, params.dataDir);
    return renderTranscriptPreview(transcript.slice(-Math.max(1, limit)));
  }
  if (params.call.toolName === "memory_search") {
    const query = stringInput(params.call.input, "query").trim();
    if (pluginRegistry?.memoryRuntime) {
      const hits = await pluginRegistry.memoryRuntime.search(query);
      return hits.join("\n");
    }
    // 这里显式走 index 层，是为了说明长期记忆通常不是“直接全量扫文件”。
    const results = await searchLearningMemory({
      workspaceDir: params.workspaceDir,
      dataDir: params.dataDir,
      query,
      maxResults: 5,
    });
    if (results.length === 0) {
      return "No memory matches found.";
    }
    return results.map((chunk) => `${chunk.path}\n${chunk.text}`).join("\n\n---\n\n");
  }
  if (params.call.toolName === "memory_get") {
    const target = stringInput(params.call.input, "path", "MEMORY.md");
    if (pluginRegistry?.memoryRuntime) {
      return await pluginRegistry.memoryRuntime.read(target);
    }
    // 读取原始 Markdown 文件，体现“memory files 才是 source of truth”。
    const result = await readLearningMemoryFile({
      workspaceDir: params.workspaceDir,
      target,
    });
    return result.text || `No memory found at ${result.path}`;
  }
  if (params.call.toolName === "memory_write") {
    const note = stringInput(params.call.input, "note").trim();
    if (pluginRegistry?.memoryRuntime) {
      const output = await pluginRegistry.memoryRuntime.write(note);
      return `Memory written to plugin:${pluginRegistry.memoryRuntime.id}\n${output}`;
    }
    // learning 版把写入统一落到 daily memory，方便区分 curated memory 和追加记忆。
    const result = await appendLearningDailyMemoryEntry({
      workspaceDir: params.workspaceDir,
      note,
      source: "manual",
    });
    return `Memory written to ${result.path}`;
  }
  if (pluginRegistry) {
    const methodName = stringInput(params.call.input, "method", "gateway.status");
    const method = pluginRegistry.gatewayMethods.find((entry) => entry.name === methodName);
    if (method) {
      return JSON.stringify(await method.handle(params.call.input));
    }
  }
  return JSON.stringify({
    ok: true,
    method: stringInput(params.call.input, "method", "gateway.status"),
    source: "learning-gateway-stub",
  });
}
