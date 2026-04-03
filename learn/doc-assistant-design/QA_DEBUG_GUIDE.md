# Learn Doc Assistant 问答排查指南

这份文档给排查 `learn/doc-assistant-design` 问答问题时使用。

目标不是解释所有实现细节，而是回答这几个最实际的问题：

- 一次问答的原始记录放在哪里
- 检索命中了什么文档
- 澄清上下文保存了什么
- 最终喂给模型的 prompt 长什么样
- 应该按什么顺序检查，才能快速判断问题出在检索、编排还是生成

## 先记住 4 个最重要的文件

排查任意一次 incident，优先看下面 4 类文件：

1. `learn/doc-assistant-design/.mini-doc-assistant-data/runtime/transcripts/*.jsonl`
2. `learn/doc-assistant-design/.mini-doc-assistant-data/question-history.jsonl`
3. `learn/doc-assistant-design/.mini-doc-assistant-data/follow-up-context.json`
4. `learn/doc-assistant-design/.mini-doc-assistant-data/agent-scratch/transcripts/*.jsonl`

它们分别代表：

- `runtime/transcripts`
  - 用户真实会话记录
  - 只看得到 user / assistant 消息
  - 适合确认“用户问了什么，系统回了什么”
- `question-history.jsonl`
  - 每轮问答的摘要记录
  - 适合确认 `runId`、`rewrittenQuestion`、`selectedProvider`、`selectedModel`、`answerOutcome`
- `follow-up-context.json`
  - 澄清态上下文缓存
  - 适合确认上一次澄清时系统保存了哪些候选平台、哪些 hits
- `agent-scratch/transcripts`
  - 真正发给模型的 prompt 和模型原始回包
  - 适合确认“模型到底看到了什么证据”

## 数据是怎么流的

主链路可以按下面理解：

1. 用户问题进入 `docs.ask`
2. `question-execution.ts` 判断是否是 greeting、follow-up、memory hit，或者进入 search
3. `doc-search.ts` 从本地索引里召回 `DocSearchHit[]`
4. `follow-up-context.ts` 在需要澄清时保存上下文
5. `question-execution.ts` 把 hits 编成 `EvidencePack`
6. `doc-answer.ts` 先生成 grounded draft answer
7. `doc-answer.ts` 再把 `question + evidence + draft answer` 组装成 prompt，发给 agent 或 OpenAI-compatible 模型
8. 最终答案写回 runtime transcript 和 question history

对应代码入口：

- `learn/doc-assistant-design/src/methods/docs.ts`
- `learn/doc-assistant-design/src/question-execution.ts`
- `learn/doc-assistant-design/src/doc-search.ts`
- `learn/doc-assistant-design/src/follow-up-context.ts`
- `learn/doc-assistant-design/src/doc-answer.ts`
- `learn/doc-assistant-design/src/answer-render.ts`

## 文档索引放在哪里

检索不是直接扫 `runtime/transcripts`，而是先把仓库 `docs/` 切成 chunk 建索引。

索引文件：

- `learn/doc-assistant-design/.mini-doc-assistant-data/doc-index.json`
- `learn/doc-assistant-design/.mini-doc-assistant-data/doc-index.meta.json`

相关代码：

- `learn/doc-assistant-design/src/doc-index.ts`
- `learn/doc-assistant-design/src/doc-search.ts`

这里保存的是可检索 chunk，而不是某次问答的最终命中结果。

## 一次 incident 的推荐排查顺序

### 第 1 步：先看 runtime transcript

先确认用户到底问了什么，系统最终到底答了什么。

看：

- `learn/doc-assistant-design/.mini-doc-assistant-data/runtime/transcripts/<session-id>.jsonl`

重点看：

- 当前 user message
- 当前 assistant message
- 如果是多轮，还要看前一轮 assistant 是否先做了 clarification

这一步只回答一个问题：

- 表面上的错误长什么样

### 第 2 步：去 question history 找 run 摘要

看：

- `learn/doc-assistant-design/.mini-doc-assistant-data/question-history.jsonl`

重点字段：

- `runId`
- `question`
- `answerOutcome`
- `selectedProvider`
- `selectedModel`
- `followUpSource`
- `continuedFromRunId`
- `rewrittenQuestion`

这一步要确认：

- 这轮是不是 follow-up
- 系统有没有重写问题
- 最终是不是走了 `mock/learning-primary`

如果 `rewrittenQuestion` 已经歪了，问题通常在 follow-up 编排层，不在模型。

### 第 3 步：如果是澄清 follow-up，就看 follow-up context

看：

- `learn/doc-assistant-design/.mini-doc-assistant-data/follow-up-context.json`

重点字段：

- `originalQuestion`
- `pendingQuestion`
- `clarificationKind`
- `questionState`
- `candidatePlatforms`
- `hits`

这一步要回答两个问题：

- 系统上一次让用户澄清的范围是什么
- 当时实际保存了哪些 hits 作为澄清证据

如果用户后续选择不在 `candidatePlatforms` 里，但系统仍然接受了这个 follow-up，就是编排 bug。

### 第 4 步：去 agent scratch 看最终 prompt

看：

- `learn/doc-assistant-design/.mini-doc-assistant-data/agent-scratch/transcripts/*.jsonl`

需要先通过 runtime / history 把时间和问题对上，再定位对应 scratch transcript。

这个文件里最关键的是第一条 `role: "user"` message。它就是最终发给模型的 prompt，通常包含：

- `Question: ...`
- `Plan kind: ...`
- `Must mention: ...`
- `Must avoid: ...`
- `Answer plan and evidence:`
- `Draft answer:`
- `FINAL_ANSWER_START / FINAL_ANSWER_END`

这一步要确认：

- 模型到底看到的是哪些证据
- `Draft answer` 在进模型前有没有已经答歪
- `Must mention` / `Must avoid` 有没有帮上忙

如果 prompt 里的 evidence 已经错了，模型只是把错误证据复述出来。

### 第 5 步：回到代码判断问题层级

通常可以按下面分层判断：

- 检索问题
  - hit 本身就错
  - 召回到不相关页面
- 编排问题
  - follow-up 被错误接纳
  - `rewrittenQuestion` 错
  - evidence group 选错
- grounded answer 问题
  - 在进模型前，draft answer 已经把任务类型判错
- agent rewrite 问题
  - draft 基本正确，但模型重写后跑偏
- 验证与降级问题
  - 最终答案明显不对，但没有被 validator 打回

## 常用代码定位点

### 跟检索相关

- `learn/doc-assistant-design/src/doc-index.ts`
  - 文档切 chunk 和索引持久化
- `learn/doc-assistant-design/src/doc-search.ts`
  - `searchDocs()`
  - `searchDocsForBucket()`
  - `searchDocsForPurpose()`

### 跟 follow-up / 澄清相关

- `learn/doc-assistant-design/src/follow-up-context.ts`
  - `detectClarificationFollowUpQuestion()`
  - `rewriteClarificationQuestion()`
  - `extractClarificationPlatforms()`
  - `updateClarificationStateAfterAnswer()`
- `learn/doc-assistant-design/src/question-execution.ts`
  - follow-up 读取、状态合并、问题重写

### 跟答案生成相关

- `learn/doc-assistant-design/src/doc-answer.ts`
  - grounded answer 选择
  - guide / concept answer 构造
  - agent prompt 组装
- `learn/doc-assistant-design/src/answer-render.ts`
  - `buildAgentPromptFromPlan()`

### 跟验证和降级相关

- `learn/doc-assistant-design/src/answer-validator.ts`
- `learn/doc-assistant-design/src/answerability.ts`
- `learn/doc-assistant-design/src/question-execution.ts`
  - `maybeReturnInsufficientEvidence()`
  - `finalizeValidatedAnswer()`

## 这次 `web` incident 的检查示例

### 现象

在这次会话里：

- 用户先问 `how to create a direct channel?`
- 系统先要求在 `Android / Flutter` 里选
- 用户回复 `web`
- 系统最终回答成了 “send a message on Web”

直接看：

- `learn/doc-assistant-design/.mini-doc-assistant-data/runtime/transcripts/ac4785d0-cb49-4724-9c1f-82b8d31b1974.jsonl`

### 第一步结论：最终答案和原问题不一致

从 runtime transcript 可以直接看出：

- user follow-up 是 `web`
- assistant 最终答的是 `Use the documented flow below to send a message on Web.`

这说明最终 answer topic 已经从 “create a direct channel” 漂到了 “send a message”。

### 第二步结论：系统把 follow-up 重写成了 Web 问题

看：

- `learn/doc-assistant-design/.mini-doc-assistant-data/question-history.jsonl`

可以看到：

- 当前轮 `question` 是 `web`
- `followUpSource` 是 `clarification_rewrite`
- `rewrittenQuestion` 是 `how to create a direct channel on Web?`

这一步说明：

- follow-up 被系统接纳了
- 系统不是原样回答 `web`，而是把它拼回上一个问题

### 第三步结论：这个 follow-up 本来不该被接纳

看：

- `learn/doc-assistant-design/.mini-doc-assistant-data/follow-up-context.json`

对应这类问题的澄清上下文里，`candidatePlatforms` 只有：

- `android`
- `flutter`

这说明前一轮澄清给用户的合法选项就是 `Android / Flutter`。

如果后续输入是 `web`，正常应该：

- 重新澄清
- 或明确说当前候选里没有 Web

而不是直接重写成 `... on Web?`

### 第四步结论：最终喂给模型的证据已经偏成 send message

看：

- `learn/doc-assistant-design/.mini-doc-assistant-data/agent-scratch/transcripts/0311bf43-9863-4177-b440-8934f311a7e5.jsonl`

这里可以直接看到最终 prompt：

- `Question: how to create a direct channel on Web?`
- `Path: docs/chatsdk-web/message/send.md`
- `Heading: Send a text message`
- `Draft answer: Use the documented flow below to send a message on Web.`

这说明模型拿到的核心 evidence 已经是 `message/send.md`，而且 draft answer 在进模型前就已经歪了。

所以这次问题不是单纯的“模型乱答”，而是：

1. follow-up 校验缺失
2. grounded answer / evidence selection 把 “create direct channel” 误判成了 “send message”

## 一份简单的排查清单

每次排查时，可以按下面的问题逐个打勾：

- 用户原问题是什么
- 最终答案是什么
- 中间有没有 clarification
- 当前轮是不是 follow-up
- `rewrittenQuestion` 是什么
- 上一轮澄清允许的候选是什么
- 这次 follow-up 是否超出候选范围
- 最终 evidence 命中了哪些文档
- `Draft answer` 在进模型前是否已经跑偏
- 如果最终答案不对，validator 为什么没拦住

## 常用命令

### 查某个 session 的 runtime transcript

```bash
sed -n '1,220p' learn/doc-assistant-design/.mini-doc-assistant-data/runtime/transcripts/<session-id>.jsonl
```

### 查最近几条 history

```bash
nl -ba learn/doc-assistant-design/.mini-doc-assistant-data/question-history.jsonl | tail -n 20
```

### 在 follow-up context 里找某个问题

```bash
rg -n "How to create a direct channel|candidatePlatforms|originalQuestion" \
  learn/doc-assistant-design/.mini-doc-assistant-data/follow-up-context.json
```

### 在 scratch transcript 里找最终 prompt

```bash
rg -n "how to create a direct channel on Web|Send a text message" \
  learn/doc-assistant-design/.mini-doc-assistant-data/agent-scratch/transcripts
```

## 最后怎么下结论

排查完成后，建议把结论落成下面这种格式：

1. 现象
2. 用户真实问题
3. 系统重写后的问题
4. 实际 evidence
5. draft answer
6. final answer
7. 根因层级
8. 应修复的代码点

根因层级尽量只选下面几类之一，避免混写：

- retrieval
- clarification / follow-up orchestration
- evidence compilation
- grounded answer heuristics
- agent rewrite
- validator / downgrade

这样后面再看 incident，就不会只停留在“答错了”，而是能直接定位到哪一层出了问题。
