/**
 * workspace-memory/files.ts — 适配层（shim）
 *
 * 这个文件没有实现逻辑，只做 re-export。
 *
 * 两类 workspace memory 文件：
 *   - Curated memory：MEMORY.md / memory.md，由用户或 agent 手动维护，启动时读入
 *   - Daily memory：memory/YYYY-MM-DD.md，由 memory_write 工具和 flush 自动追加
 *
 * 这里只是把 session-memory-design 提供的能力映射成 agent 层用的名字，
 * 让 agent 代码不需要知道文件路径规则是怎么实现的。
 *
 * 如果你想看路径规则和文件读写实现，去 session-memory-design/src/workspace-memory.ts。
 */
export {
  appendLearningDailyMemoryEntry as appendDailyMemoryEntry,
  listLearningMemoryFiles as listWorkspaceMemoryFiles,
  loadLearningBootstrapMemory as loadBootstrapMemory,
  readLearningMemoryFile as readWorkspaceMemoryFile,
  resolveLearningCuratedMemoryPath as resolveCuratedMemoryPath,
  resolveLearningDailyMemoryPath as resolveDailyMemoryPath,
  resolveLearningMemoryWorkspaceDir as resolveMemoryWorkspaceDir,
} from "../../../session-memory-design/src/index.js";
