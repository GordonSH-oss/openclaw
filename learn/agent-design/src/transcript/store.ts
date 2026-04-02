/**
 * transcript/store.ts — 适配层（shim）
 *
 * 这个文件没有实现任何逻辑，只做 re-export。
 *
 * 为什么要保留这一层而不是直接 import session-memory-design？
 *
 * 在真实 OpenClaw 里，agent 代码通过本地路径 import transcript 工具，
 * 而不是直接跨越模块边界 import session/memory 层。
 * 这个 shim 模拟了这种分层：
 *   - agent-design 内部代码只知道"有个 transcript 工具集"
 *   - transcript 工具的底层实现属于 session-memory-design，不是 agent 层关心的
 *
 * 如果你想看实现，去 session-memory-design/src/transcript-store.ts。
 */
export {
  appendLearningTranscriptMessage as appendTranscriptMessage,
  ensureLearningTranscriptDir as ensureTranscriptDir,
  getLearningTranscriptPath as getTranscriptPath,
  loadLearningTranscript,
  resolveLearningSessionMemoryDataDir as resolveLearningAgentDataDir,
} from "../../../session-memory-design/src/index.js";
