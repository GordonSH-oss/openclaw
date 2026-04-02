/**
 * workspace-memory/index.ts — 适配层（shim）
 *
 * 这个文件没有实现逻辑，只做 re-export。
 *
 * memory_search 工具需要的"索引检索"能力由 session-memory-design 提供：
 *   - buildMemoryIndex：扫描 workspace memory 文件，切成 chunk，写入 JSON index
 *   - searchMemoryIndex：根据 query 在 index 里做关键词匹配
 *
 * 学习重点：
 *   - 检索索引（index）和 memory 文件（source of truth）是分开的
 *   - 这样做的原因：文件可能很大，不适合每次都全量扫描
 *   - 真实 OpenClaw 里 index 还会走 SQLite / vector / hybrid search
 *
 * 实现细节见 session-memory-design/src/memory-index.ts。
 */
export {
  buildLearningMemoryIndex as buildMemoryIndex,
  searchLearningMemory as searchMemoryIndex,
  type LearningMemoryChunk as MemoryIndexChunk,
} from "../../../session-memory-design/src/index.js";
