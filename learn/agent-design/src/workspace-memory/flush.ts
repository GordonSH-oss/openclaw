/**
 * workspace-memory/flush.ts — 适配层（shim）
 *
 * 这个文件没有实现逻辑，只做 re-export。
 *
 * 真正的 pre-compaction memory flush 实现在 session-memory-design/src/memory-flush.ts。
 * 这里保留一个薄 shim，让 embedded-runner 只依赖"有 flush 能力"这个概念，
 * 而不需要知道 flush 是怎么实现的。
 *
 * 学习重点：
 *   flush 的触发条件（transcript 积累多少消息后触发）在 session-memory-design 里配置，
 *   触发后会把近期 transcript 摘要追加进 daily memory 文件。
 */
export { flushLearningSessionMemory as maybeFlushSessionMemory } from "../../../session-memory-design/src/index.js";
