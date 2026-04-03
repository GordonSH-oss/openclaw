# Learn Doc Assistant 问答效果改造执行计划

## 文档目的

这份计划只回答一个问题：

- 如何把 `learn/doc-assistant-design` 现有的文档问答链路，逐步改造成一套更稳定、更可控、更容易持续优化的问答系统。

这不是目标架构宣言，也不是一次性大重写方案。它是面向实现的执行计划，强调：

- 每一期能独立落地
- 每一期都有明确改动文件
- 每一期都有验收标准
- 每一期都能通过测试和 smoke 验证

## 改造目标

本轮改造优先提升以下问题：

- 平台相关问题不再混答 Android / iOS / Web / Flutter
- 泛化问题先澄清，再回答，不强行猜
- 混合问题能拆成概念部分和步骤部分分别处理
- 回答不再直接依赖 top hits 平铺，而是基于整理后的证据包
- agent 模式不只是润色，而是受控地基于证据生成
- eval 能发现“看起来像对，实际答错”的情况

本轮改造不做这些事：

- 不做协议破坏性升级
- 不改前端 UI 交互模型
- 不引入通用插件系统
- 不引入复杂 embedding 基础设施作为前置条件
- 不把 learning 包改造成完整 agent 平台

## 当前主链问题

当前主链大致是：

1. `src/question-execution.ts` 做 follow-up / memory / search 路由
2. `src/doc-search.ts` 做词法检索和大量领域打分
3. `src/doc-answer.ts` 基于 hits 生成 extractive 或 agent answer
4. `src/follow-up-context.ts` 只保存较窄的澄清状态
5. `src/answer-memory.ts` 主要承担答案缓存

主要问题：

- 问题状态过薄，很多信息只在局部函数里临时推断
- 检索是单轮 top hits 模式，没有显式“主任务证据”和“补充证据”
- 回答层直接消费 hits，缺少中间证据编译层
- follow-up 基本只覆盖平台，不够支撑真实多轮问答
- eval 以 retrieval path 命中为主，对答案形态约束不够

## 实施原则

### 原则 1：先稳住控制面，再追求模型收益

优先改造：

- question state
- clarification policy
- retrieval plan
- evidence pack

后改造：

- agent render
- 经验记忆
- 更重的 rerank 能力

### 原则 2：旧行为先兼容，再替换

- 新模块先以 wrapper 或 facade 接入
- 旧导出先保留，避免一次改穿全链路
- 每一期只替换一层主职责

### 原则 3：所有策略改动都要带 eval

- 不接受只有主观感觉“回答变好了”
- 每一个阶段至少要新增一批 eval case

## 目标分层

目标链路收敛为：

1. Question Intake
2. Question State Build
3. Clarification Decision
4. Retrieval Plan
5. Primary Retrieval
6. Expansion Retrieval
7. Evidence Pack Compile
8. Answer Plan
9. Final Answer Render
10. Answer Validate
11. Memory / Trace Writeback

对应代码层建议：

- `src/question-state.ts`
- `src/clarification-policy.ts`
- `src/retrieval-plan.ts`
- `src/evidence-pack.ts`
- `src/answer-validator.ts`
- `src/retrieval-memory.ts`

现有文件继续承担这些职责：

- `src/question-execution.ts`
  负责总编排
- `src/doc-search.ts`
  负责原子检索和基础评分
- `src/doc-answer.ts`
  负责 grounded answer / agent render
- `src/follow-up-context.ts`
  负责 session 级状态持久化
- `src/answer-memory.ts`
  负责答案复用

## 从 Claude Code 提炼的可借鉴经验

下面这些经验不是“照搬 Claude Code”，而是从它已经验证有效的控制面实现里，抽出适合 `learn/doc-assistant-design` 的部分。

### 经验 1：稳定前缀和动态上下文要分层

Claude Code 的 query 入口明确区分：

- 稳定的 system prompt
- 动态的 user context
- 动态的 system context

可借鉴点：

- `QuestionState` 只表达稳定的问题理解，不混入检索结果和临时证据
- retrieval、evidence、validator 输出都作为动态上下文参与后续阶段
- 回答层不要再自己重复推断 platform、intent、channel kind

落地映射：

- Phase 1
- Phase 4
- Phase 5

### 经验 2：把“小判断”下沉为 side query 或独立策略，不要让主回答顺手做

Claude Code 会用 side query 做 memory 选择、权限解释、分类等辅助判定，而不是把这些事情都交给主对话模型顺手完成。

可借鉴点：

- 澄清判定、referent 归一化、mixed question 拆解、证据组 summary 这些都适合走“轻量决策层”
- 第一版可以先用规则实现，但要预留 side-query seam，后面可逐步替换

落地映射：

- Phase 2
- Phase 3
- Phase 4
- Phase 8

### 经验 3：memory / attachment 要预取，并且必须做去重

Claude Code 会异步预取 relevant memories，并在真正注入上下文前过滤“已经在上下文里出现过”的内容，避免重复喂给模型。

可借鉴点：

- retrieval expansion、follow-up 复用、retrieval memory 命中都应先收集，再统一去重
- 不能因为 expansion 查到了同页相邻 chunk，就把同一页面内容反复喂给回答层

落地映射：

- Phase 3
- Phase 4
- Phase 7

### 经验 4：query loop 需要显式的预算与恢复，而不是超了就失败

Claude Code 的 query loop 会在多个位置处理上下文过大问题：

- 工具结果预算控制
- microcompact / autocompact
- overflow 后 reactive compact 再重试

可借鉴点：

- `doc-assistant-design` 也需要 evidence budget
- 当证据包超预算时，先裁剪低优先级内容，而不是直接把超长上下文喂给模型
- 裁剪应有明确顺序和 trace

落地映射：

- Phase 4
- Phase 5
- Phase 6

### 经验 5：非关键衍生信息可以后台生成，不阻塞主路径

Claude Code 会在工具调用完成后后台生成 tool summary，而不是阻塞下一轮主 query。

可借鉴点：

- retrieval summary、evidence group label、调试 trace 摘要都可以后台生成
- 主回答链路优先保证正确和稳定，再补用户可读的衍生信息

落地映射：

- Phase 0
- Phase 4
- Phase 8

### 经验 6：恢复路径也要成为正式设计的一部分

Claude Code 的恢复不是异常分支里的临时代码，而是 query state machine 的正式 transition。

可借鉴点：

- `doc-assistant-design` 也要把“澄清降级”“证据不足降级”“超预算裁剪后重试”当成正式状态流转
- validator 不应只报错，还要能触发降级策略

落地映射：

- Phase 2
- Phase 4
- Phase 6

## 横向控制能力（跨 Phase 落地）

这些能力不是单独一期完成，而是从前到后持续接入。

### 控制能力 1：State / Context 分离

- 稳定状态：`QuestionState`
- 动态状态：retrieval hits、evidence pack、validator issues、trace
- 会话状态：follow-up pending state、resolved slots、memory hits

### 控制能力 2：Side-Decision Seam

- 第一版先规则实现
- 接口设计上预留轻量 side-query 替换点
- 仅用于辅助判定，不直接生成最终 answer

优先适用场景：

- clarification decision
- mixed question decomposition
- referent normalization
- evidence group summary

### 控制能力 3：Evidence Budget

- 为 evidence pack 设总预算
- 为每个 group 设局部预算
- 超预算时按优先级裁剪，而不是整体失败

建议裁剪顺序：

1. 重复 snippets
2. 相邻弱证据
3. 低优先级 `overview`
4. 低优先级 `api_reference`
5. 非必要 `prerequisite`

### 控制能力 4：Recovery as Transition

以下场景要显式记录 transition，而不是只在日志里体现：

- clarification required
- evidence overflow trimmed
- validator downgrade to clarification
- validator downgrade to insufficient
- retrieval memory override

### 控制能力 5：Non-Blocking Derived Signals

这些信息不该阻塞主回答：

- trace summary
- evidence group short label
- retrieval explanation
- 经验记忆候选项

## Phase 0：基线固定

### 目标

在改行为之前先固定现有主链路，避免后续不知道是“优化了”还是“改坏了”。

### 范围

- 只加测试和观测
- 不改主逻辑

### 具体工作

1. 盘点当前测试覆盖：
   - `src/eval.test.ts`
   - `src/http.test.ts`
   - `src/index.test.ts`
   - `src/cli.test.ts`
   - `src/answer-memory.test.ts`

2. 补足以下回归测试：
   - greeting route
   - memory route
   - search route
   - platform clarification
   - clarification follow-up reuse
   - agent mode answer path
   - openai-compatible answer path
   - embedded / mock answer surface 标记
   - prompt echo transcript replay

3. 增加 trace 输出开关，至少记录：
   - 原始问题
   - `QuestionState` 快照
   - 命中 route
   - answer surface trust
   - output contract mode
   - clarification decision
   - top retrieval hits
   - retrieval plan 概览
   - evidence pack 预算与裁剪信息
   - 最终 summary
   - validator issues

### 主要改动文件

- `src/eval.test.ts`
- `src/http.test.ts`
- `src/index.test.ts`
- `src/question-execution.ts`
- `src/smoke.ts`

### 验收标准

- `npm test` 通过
- `npm run eval -- --docs-root <docs-root>` 可以稳定跑完
- trace 记录不影响现有协议
- mock / embedded run 不会再被误当成真实 answer-quality 样本

## Phase 0.x：评测面可信度与 Prompt Contract 加固

### 目标

先堵住这次事故暴露出的两个最高风险通道：

- 不可信的 answer evaluation surface
- prompt echo 可以伪装成成功答案的输出契约

### 范围

- 允许改主逻辑
- 优先处理 `agent` 路径和 eval / smoke 判定逻辑
- 不在这一期引入完整 evidence pack 或 validator 架构

### 具体工作

1. 明确 answer surface trust 模型：
   - 把 `embedded + mock/learning-*` 标记为 `non_authoritative`
   - 把真实 remote / cli completion 标记为 `authoritative`
   - trace 中记录 `answerSurface.kind` 和 `answerSurface.trust`

2. 修改 `src/eval.ts` / `src/smoke.ts`：
   - 遇到 `non_authoritative` surface 时，不做答案质量通过判定
   - transcript replay 遇到 prompt echo 风格输出时，标为 invalid sample

3. 加固 `src/doc-answer.ts` 输出契约：
   - 不再把 draft answer 放进可被 parser 接收的 sentinel 区域
   - 替换 `sliceBetweenSentinels(...)` 为更安全的 completion parser，或只在明确可信 surface 上启用
   - prompt echo 命中时，回退到明确的 invalid output / insufficient answer，而不是接受草稿

4. 同步收敛 `src/openai-compatible.ts`：
   - 与本地 agent 路径对齐 output contract
   - 不能继续依赖“只要返回文本并带 Sources 就算成功”

5. 新增专项测试：
   - embedded runner transcript 不可作为最终 answer 评估样本
   - 完整 prompt echo 不会被 parser 当作最终答案
   - sentinel / output envelope 被原样回显时，系统进入 fail-closed

### 主要改动文件

- `src/doc-answer.ts`
- `src/openai-compatible.ts`
- `src/eval.ts`
- `src/eval.test.ts`
- `src/smoke.ts`
- `src/index.test.ts`

### 验收标准

- prompt 原样回显时，系统不会把 draft answer 当作成功输出
- eval 报告能区分 `authoritative` 和 `non_authoritative` answer surface
- openai-compatible 与本地 agent 路径的 output contract 行为一致
- 这次 `push notification language` transcript replay 不会再被误判为成功答案

## Phase 1：引入 Question State

### 目标

把“用户问题的结构化理解”从散落在各文件的启发式中抽出来，形成统一的 `QuestionState`。

### 新增文件

- `src/question-state.ts`

### 数据结构

```ts
export type QuestionState = {
  rawQuestion: string;
  normalizedQuestion: string;
  language: "zh" | "en";
  intent: "concept" | "procedural" | "mixed";
  taskKind?: "first_message" | "send_message" | "start_chat" | "channel_creation" | "generic";
  platform?: "android" | "ios" | "web" | "flutter";
  product?: "chat" | "call" | "server";
  apiLayer?: "client" | "server";
  channelKind?: "direct" | "group" | "community" | "open";
  messageSubtype?: "text" | "image" | "file" | "voice" | "targeted" | "generic";
  referent?: string;
  ambiguity: {
    missingPlatform: boolean;
    missingChannelKind: boolean;
    missingApiLayer: boolean;
    missingProduct: boolean;
  };
};
```

### 具体工作

1. 从这些文件中抽出已有检测逻辑：
   - `src/doc-search.ts`
   - `src/doc-answer.ts`
   - `src/follow-up-context.ts`

2. 在 `src/question-state.ts` 中集中实现：
   - `buildQuestionState(question: string): QuestionState`
   - `mergeFollowUpIntoQuestionState(...)`
   - `rewriteQuestionFromState(...)`

   设计要求：
   - `QuestionState` 只保存稳定问题理解
   - 不把 hits、citations、summary 等动态结果混进 state
   - 后续允许 side-decision 层直接消费 state

3. 修改 `src/question-execution.ts`：
   - 开头先构造 `QuestionState`
   - 后续路由逻辑都消费 state，而不是再次局部解析

4. 修改 `src/follow-up-context.ts`：
   - 持久化 `QuestionState` 的关键字段
   - 不再只保存 platform

### 主要改动文件

- `src/question-execution.ts`
- `src/follow-up-context.ts`
- `src/doc-search.ts`
- `src/doc-answer.ts`
- `src/question-state.ts`

### 新增测试

- `src/question-state.test.ts`

覆盖：

- 英文概念问题
- 中文概念问题
- 泛 channel 问题
- 泛 connect 问题
- 带 referent 的 mixed 问题
- follow-up 合并平台

### 验收标准

- 现有主链路行为不倒退
- state 能被完整打印到 trace
- 平台、channel kind、api layer 至少能被稳定识别一部分

## Phase 2：引入 Clarification Policy

### 目标

把“是否该先问清楚”从回答层里抽出来，变成独立策略。

### 新增文件

- `src/clarification-policy.ts`

### 关键输出

```ts
export type ClarificationDecision = {
  shouldClarify: boolean;
  kind?: "platform" | "channel_kind" | "api_layer" | "product";
  question?: string;
  pendingState?: Partial<QuestionState>;
};
```

### 具体工作

1. 在 `src/clarification-policy.ts` 中实现：
   - `decideClarification(state, hits?): ClarificationDecision`

   实现要求：
   - 第一版以规则为主
   - 预留 side-decision seam，后续可替换部分判定为轻量 side query
   - 不允许把 clarification 判定继续塞回 `doc-answer.ts`

2. 抽离当前分散逻辑：
   - `doc-answer.ts` 中与澄清相关的判断
   - `question-execution.ts` 中 follow-up 分流逻辑

3. 修改 `src/question-execution.ts`：
   - route 判断顺序收敛为：
     1. greeting
     2. follow-up merge
     3. memory lookup
     4. retrieval
     5. clarification decision
     6. answer generation

4. 修改 `src/follow-up-context.ts`：
   - 保存 `pendingState`
   - 支持 platform 之外的 follow-up 类型扩展

### 主要改动文件

- `src/question-execution.ts`
- `src/follow-up-context.ts`
- `src/doc-answer.ts`
- `src/clarification-policy.ts`

### 新增测试

- `src/follow-up-context.test.ts`
- `src/question-execution.test.ts`

覆盖：

- 缺 platform 时要求澄清
- 缺 channel kind 时要求澄清
- 缺 api layer 时要求澄清
- mixed question 只对 procedural half 澄清

### 验收标准

- “How to create a channel?” 不再直接给单一路径答案
- “How to connect?” 在模糊情况下不再混 client/server
- 平台 follow-up 行为不回退

## Phase 1 详细实施蓝图

这一节把 Phase 1 拆到可直接编码的粒度。目标不是一次把所有字段都做到完美，而是先建立稳定的数据骨架，并让主链开始消费它。

### Phase 1 实现范围

第一版 `QuestionState` 只强制覆盖这些槽位：

- `language`
- `intent`
- `taskKind`
- `platform`
- `channelKind`
- `apiLayer`
- `referent`
- `ambiguity`

这些先不在第一版强求高准确率：

- `product`
- `messageSubtype`

原因：

- 当前最明显的答错来源是 platform、channel kind、client/server 混答
- 把第一版 scope 控制住，才能避免 `question-state.ts` 一上来变成新的大文件

### Phase 1 文件级改造清单

#### 1. 新增 `src/question-state.ts`

第一版建议导出这些类型和函数：

```ts
export type QuestionLanguage = "zh" | "en";
export type QuestionIntent = "concept" | "procedural" | "mixed";
export type QuestionPlatform = "android" | "ios" | "web" | "flutter";
export type QuestionChannelKind = "direct" | "group" | "community" | "open";
export type QuestionApiLayer = "client" | "server";

export type QuestionState = {
  rawQuestion: string;
  normalizedQuestion: string;
  language: QuestionLanguage;
  intent: QuestionIntent;
  taskKind?: "first_message" | "send_message" | "start_chat" | "channel_creation" | "generic";
  platform?: QuestionPlatform;
  product?: "chat" | "call" | "server";
  apiLayer?: QuestionApiLayer;
  channelKind?: QuestionChannelKind;
  messageSubtype?: "text" | "image" | "file" | "voice" | "targeted" | "generic";
  referent?: string;
  ambiguity: {
    missingPlatform: boolean;
    missingChannelKind: boolean;
    missingApiLayer: boolean;
    missingProduct: boolean;
  };
};

export function buildQuestionState(question: string): QuestionState;

export function mergeQuestionState(
  base: QuestionState,
  patch: Partial<QuestionState>,
): QuestionState;

export function rewriteQuestionFromState(state: QuestionState): string;
```

内部私有函数建议：

- `normalizeQuestionText`
- `detectQuestionLanguage`
- `detectQuestionPlatform`
- `detectQuestionChannelKind`
- `detectQuestionApiLayer`
- `detectQuestionReferent`
- `computeQuestionAmbiguity`

设计要求：

- 所有 detect 函数纯函数化
- `buildQuestionState` 不依赖 IO
- 不依赖 `DocSearchHit`
- 不写入 follow-up store

#### 2. 修改 `src/follow-up-context.ts`

第一版不要直接推翻现有 `StoredClarificationContext`，而是增量扩展：

```ts
type StoredClarificationContext = {
  sessionId: string;
  runId: string;
  originalQuestion: string;
  pendingQuestion?: string;
  normalizedQuestion?: string;
  questionState?: Pick<
    QuestionState,
    "intent" | "taskKind" | "platform" | "channelKind" | "apiLayer" | "referent" | "ambiguity"
  >;
  taskKind?: DocProceduralTaskKind;
  preferredDocShape?: DocPreferredDocShape;
  originalTopHitShapes?: DocSearchDocShape[];
  candidatePlatforms: DocFollowUpPlatform[];
  hits: DocSearchHit[];
  createdAt: number;
};
```

第一版只新增这些函数：

```ts
export function extractQuestionStatePatchFromFollowUp(
  question: string,
): Partial<QuestionState> | null;

export function mergeStoredStateWithFollowUp(
  base: QuestionState,
  patch: Partial<QuestionState>,
): QuestionState;
```

实施要求：

- 保留 `detectClarificationFollowUpQuestion`
- 旧平台 follow-up 流程继续可用
- 新增状态字段只作为增强，不立即替换全部旧逻辑

#### 3. 修改 `src/question-execution.ts`

第一版只做最小接入，不重写全部路由：

建议增加：

```ts
type ExecuteDocQuestionResult = {
  route: "greeting" | "memory" | "search";
  hits: DocSearchHit[];
  answer: DocAnswerResult;
};
```

在 `executeDocQuestion()` 的前半段加入：

1. `const initialState = buildQuestionState(params.question);`
2. 如果命中 follow-up：
   - 取出 stored context
   - 从 follow-up 文本提取 patch
   - `mergeQuestionState(...)`
   - 调 `rewriteQuestionFromState(...)`
3. 后续 memory / search 使用 rewritten question
4. trace 中记录 state

第一版不要做的事：

- 不在这里引入 retrieval plan
- 不改 `buildDocAnswer` 的输入签名
- 不在这里引入 validator

#### 4. 修改 `src/doc-answer.ts`

第一版只做“减少重复推断”：

- 保留当前逻辑
- 把可复用的 detect 函数迁到 `question-state.ts`
- `doc-answer.ts` 改为导入这些公共函数

目标：

- 让问题分类的 source of truth 逐步收敛
- 暂时不改变回答层输出结构

#### 5. 修改 `src/protocol/index.ts`

第一版不改对外 RPC 协议。

如果要给 trace 或 terminal result 暴露额外字段，只允许增加 `meta` 类可选字段，不允许改已有字段语义。

### Phase 1 推荐实施顺序

1. 新建 `src/question-state.ts`
2. 把纯检测函数先搬过去
3. 加 `src/question-state.test.ts`
4. 扩展 `src/follow-up-context.ts`
5. 在 `src/question-execution.ts` 接入 state
6. 跑现有测试
7. 最后再清理 `doc-answer.ts` 内重复 detect 逻辑

### Phase 1 测试清单

新增 `src/question-state.test.ts`，建议包含这些用例：

```ts
[
  "what is community channel",
  "How to start a direct chat?",
  "How to connect?",
  "How to create a channel?",
  "What is community channel? How to create it?",
  "我要找 android 的",
];
```

断言重点：

- `intent`
- `platform`
- `channelKind`
- `apiLayer`
- `referent`
- `ambiguity`

回归测试要求：

- `src/eval.test.ts`
- `src/http.test.ts`
- `src/index.test.ts`

### Phase 1 完成定义

满足以下条件即可结束，不追求更多：

- `executeDocQuestion()` 已经显式构造 `QuestionState`
- follow-up 流程可以合并 state patch
- 平台 / channel kind / api layer 至少进入统一 state
- 当前输出行为与现有 eval 大体一致

### Phase 1 回退策略

如果接入 `QuestionState` 后出现大面积回归：

1. 保留 `src/question-state.ts`
2. 暂时只把它作为 trace 输出
3. 撤回 `question-execution.ts` 中对主路由的强依赖
4. 继续把 detect 逻辑集中，但不让它决定主流程

也就是说，`QuestionState` 模块本身不应成为阻塞项。

## Phase 2 详细实施蓝图

这一节的目标是把“是否先问清楚”从 `doc-answer.ts` 和 follow-up 细节里彻底抬出来，形成可测试、可替换的策略层。

### Phase 2 实现范围

第一版 Clarification Policy 只处理四类问题：

- platform 不明确
- channel kind 不明确
- api layer 不明确
- mixed 问题中 procedural half 缺必要槽位

第一版先不做：

- product clarification
- message subtype clarification
- 多轮复杂冲突消解

### Phase 2 文件级改造清单

#### 1. 新增 `src/clarification-policy.ts`

建议第一版导出：

```ts
export type ClarificationKind = "platform" | "channel_kind" | "api_layer" | "product";

export type ClarificationDecision = {
  shouldClarify: boolean;
  kind?: ClarificationKind;
  question?: string;
  reason?: string;
  pendingState?: Partial<QuestionState>;
  candidateOptions?: string[];
};

export function decideClarification(params: {
  state: QuestionState;
  hits?: DocSearchHit[];
}): ClarificationDecision;
```

内部私有函数建议：

- `needsPlatformClarification`
- `needsChannelKindClarification`
- `needsApiLayerClarification`
- `buildClarificationPrompt`

设计要求：

- 输入只依赖 `QuestionState` 和可选 `hits`
- 输出必须可序列化，便于 trace
- 第一版不依赖模型

#### 2. 修改 `src/question-execution.ts`

建议把当前函数拆成几个局部 helper，即使还不新建文件也要拆：

```ts
async function resolveFollowUpQuestion(...): Promise<{
  effectiveQuestion: string;
  effectiveState: QuestionState;
  followUpSource?: DocFollowUpSource;
  continuedFromRunId?: string;
}>;

async function tryAnswerMemory(...): Promise<...>;

async function runRetrieval(...): Promise<DocSearchHit[]>;
```

然后把主顺序固定为：

1. 构造 `QuestionState`
2. 处理 follow-up merge
3. greeting route
4. memory lookup
5. retrieval
6. clarification decision
7. answer generation

这里的关键变化：

- clarification decision 发生在 retrieval 之后
- 但发生在 `buildDocAnswer(...)` 之前
- 一旦要澄清，直接返回 clarification answer，不把责任再交给 `doc-answer.ts`

#### 3. 修改 `src/doc-answer.ts`

Phase 2 要求把这些责任从 `doc-answer.ts` 移走：

- 是否该先问平台
- 是否该先问 channel kind
- 是否该先问 api layer

`doc-answer.ts` 可以保留：

- 如何把 clarification decision 渲染成最终答复文本

建议新增轻量 helper：

```ts
export function renderClarificationAnswer(params: {
  decision: ClarificationDecision;
  hits: DocSearchHit[];
  language: "zh" | "en";
  mode: DocAssistantMode;
}): DocAnswerResult;
```

这样 clarification 的“判定”和“文案渲染”就分开了。

#### 4. 修改 `src/follow-up-context.ts`

新增或调整这些能力：

- 存储 `pendingState`
- follow-up 回来时，不只改 question string，也改 state
- 允许将 `kind` 一起持久化，便于下一轮判断用户是不是在回答澄清

建议增加：

```ts
type StoredClarificationContext = {
  ...
  clarificationKind?: "platform" | "channel_kind" | "api_layer" | "product";
  pendingState?: Partial<QuestionState>;
};
```

### Phase 2 测试清单

新增 `src/question-execution.test.ts`，建议覆盖：

1. `How to create a channel?`
   - 应返回 clarification
   - `kind === "channel_kind"`

2. `How to connect?`
   - 应返回 clarification
   - `kind === "api_layer"` 或 platform 相关澄清

3. `How to start a direct chat?`
   - hits 跨平台时应返回 platform clarification

4. `What is community channel? How to create it?`
   - 只对 procedural half 触发 clarification

5. follow-up `Android`
   - 能消解 platform clarification

### Phase 2 完成定义

满足以下条件即可结束：

- clarification 判定不再散落在 `doc-answer.ts`
- `question-execution.ts` 已显式调用 `decideClarification(...)`
- follow-up store 能保存 pending state
- 常见泛化问题优先澄清，而不是直接猜

### Phase 2 回退策略

如果 clarification policy 引入后误判过多：

1. 保留 `clarification-policy.ts`
2. 仅对 platform clarification 启用
3. 暂时关闭 channel kind / api layer clarification
4. 继续保留 trace，收集误判样本后再放开

这样可以避免第二期就因为策略过宽把主链打坏。

## Phase 1 / Phase 2 联合验收命令

开发这两期时，建议固定跑这组命令：

```bash
cd learn/doc-assistant-design
npm run typecheck
npm test
npm test -- src/eval.test.ts
```

如果你新增了独立测试文件，建议在提交前再补跑：

```bash
cd learn/doc-assistant-design
node --import ../gateway-design/node_modules/tsx/dist/loader.mjs --test \
  src/question-state.test.ts \
  src/question-execution.test.ts
```

## Phase 3：引入 Retrieval Plan

### 目标

把检索从单次 top hits 变成两阶段：

- 主任务召回
- 补充证据召回

### 新增文件

- `src/retrieval-plan.ts`

### 核心结构

```ts
export type RetrievalPlan = {
  primaryQueries: Array<{
    bucket: "concept" | "procedural";
    query: string;
  }>;
  expansionQueries: Array<{
    purpose: "prerequisite" | "overview" | "adjacent" | "api";
    query: string;
  }>;
};
```

### 具体工作

1. 在 `src/retrieval-plan.ts` 中实现：
   - `buildRetrievalPlan(state: QuestionState): RetrievalPlan`

2. 修改 `src/question-execution.ts`：
   - 不再直接一次调用 `searchDocs`
   - 改为按 plan 执行 primary + expansion

3. 改造 `src/doc-search.ts`：
   - 保留 `searchDocs`
   - 新增更底层的原子方法，例如：
     - `searchDocsForBucket(...)`
     - `searchDocsForPurpose(...)`

4. 为 expansion 查询补上几类目的：
   - prerequisite
   - overview
   - adjacent
   - api

5. 为 retrieval plan 预留轻量判定 seam：
   - 第一版不强制引入模型
   - 但接口上允许未来用 side-query 辅助 mixed question decomposition 或 expansion purpose 选择

### 主要改动文件

- `src/question-execution.ts`
- `src/doc-search.ts`
- `src/retrieval-plan.ts`

### 新增测试

- `src/doc-search.test.ts`
- `src/retrieval-plan.test.ts`

覆盖：

- procedural 问题优先 specialized task
- concept 问题优先 overview / glossary
- mixed 问题 concept / procedural 分开查
- send-message 问题能补 prerequisite hits

### 验收标准

- 检索结果不只是一个 bucket 的 top hits
- how-to 问题能更稳定带出 prerequisites / overview
- eval case 的 topK 命中率不下降

## Phase 3 详细实施蓝图

这一期的核心目标不是“换检索算法”，而是把当前 `searchDocs()` 的单次 top hits 调用，升级成显式检索编排。

### Phase 3 实现范围

第一版 staged retrieval 只做这些能力：

- primary retrieval
- expansion retrieval
- primary / expansion 去重
- retrieval trace

第一版先不做：

- embedding rerank
- 模型参与 expansion purpose 判定
- retrieval memory 覆盖打分

### Phase 3 文件级改造清单

#### 1. 新增 `src/retrieval-plan.ts`

建议导出：

```ts
export type RetrievalPurpose =
  | "primary_concept"
  | "primary_procedural"
  | "prerequisite"
  | "overview"
  | "adjacent"
  | "api";

export type RetrievalQuery = {
  purpose: RetrievalPurpose;
  query: string;
  bucket?: "concept" | "procedural";
  limit: number;
};

export type RetrievalPlan = {
  primaryQueries: RetrievalQuery[];
  expansionQueries: RetrievalQuery[];
};

export function buildRetrievalPlan(params: {
  state: QuestionState;
  maxResults?: number;
}): RetrievalPlan;
```

第一版约束：

- `primaryQueries` 最多 2 个
- `expansionQueries` 最多 3 个
- expansion 默认总数不超过 primary 数量

#### 2. 改造 `src/doc-search.ts`

目标不是推翻现有评分函数，而是把它拆出可复用入口。

建议新增导出：

```ts
export async function loadDocChunks(params?: {
  docsRoot?: string;
  dataDir?: string;
}): Promise<DocIndexChunk[]>;

export function searchDocsForBucket(params: {
  chunks: DocIndexChunk[];
  question: string;
  bucket: DocRetrievalBucket;
  limit: number;
  refinement?: {
    taskKind?: DocProceduralTaskKind;
    preferredDocShape?: DocPreferredDocShape;
  };
}): DocSearchHit[];

export function searchDocsForPurpose(params: {
  chunks: DocIndexChunk[];
  question: string;
  purpose: RetrievalPurpose;
  state: QuestionState;
  limit: number;
}): DocSearchHit[];
```

保留兼容层：

```ts
export async function searchDocs(...) { ... }
```

让旧调用方先不崩，再逐步迁移。

#### 3. 修改 `src/question-execution.ts`

这一期开始将 retrieval 独立成局部 helper：

```ts
async function runStagedRetrieval(params: {
  question: string;
  state: QuestionState;
  docsRoot: string;
  dataDir?: string;
  maxResults?: number;
}): Promise<{
  hits: DocSearchHit[];
  plan: RetrievalPlan;
  trace: {
    primary: Array<{ purpose: string; query: string; hitCount: number }>;
    expansion: Array<{ purpose: string; query: string; hitCount: number }>;
  };
}>;
```

实施细节：

1. 先加载一次 `chunks`
2. 运行 primary queries
3. 运行 expansion queries
4. 按 `path:start:end` 去重
5. 优先保留 primary hits
6. 返回 merged hits 和 trace

#### 4. trace 扩展

Phase 3 起 trace 至少新增这些字段：

```ts
type RetrievalTrace = {
  primaryQueries: Array<{ purpose: string; query: string; hitCount: number }>;
  expansionQueries: Array<{ purpose: string; query: string; hitCount: number }>;
  mergedHitCount: number;
};
```

### Phase 3 评分策略要求

第一版 expansion 的 purpose 处理建议：

- `prerequisite`
  偏向 requirements / setup / connect / quickstart
- `overview`
  偏向 overview / glossary / about
- `adjacent`
  偏向当前 top page 的相关 step 或同页内容
- `api`
  偏向 message/send/connect/create 等 API 页面

这里的关键点是：

- purpose 改变的是 rerank 倾向
- 不是简单换 query 字符串

### Phase 3 测试清单

新增 `src/retrieval-plan.test.ts`：

- direct chat procedural 问题生成 primary + overview
- concept 问题生成 primary_concept + overview
- mixed 问题只为 procedural half 加 expansion

新增 `src/doc-search.test.ts`：

- `searchDocsForBucket(...)` 与旧 `searchDocs(...)` 行为大体一致
- `searchDocsForPurpose(... purpose="prerequisite")` 能拉起 setup/connect
- `searchDocsForPurpose(... purpose="overview")` 不应压过主 procedural task

### Phase 3 完成定义

满足以下条件即可结束：

- `question-execution.ts` 已经使用 staged retrieval helper
- `doc-search.ts` 已拆出 bucket / purpose 入口
- 检索 trace 可以看到 primary / expansion 分别命中了什么
- 旧 `searchDocs(...)` 仍可用

### Phase 3 回退策略

如果 staged retrieval 让相关性明显下降：

1. 保留 `retrieval-plan.ts`
2. 只启用 primary retrieval
3. expansion 仅保留 `overview`
4. trace 继续记录，等 evidence pack 期一起再调

## Phase 4 详细实施蓝图

这一期是主链质量跃迁最大的阶段。目标是把原始 hits 转成结构化证据包，让后续回答层和 validator 都能消费同一份“证据现实”。

### Phase 4 实现范围

第一版 evidence pack 只做这些能力：

- 相邻 chunk 合并
- 同源证据去重
- 按 purpose 分组
- group summary
- evidence budget
- trim trace

第一版先不做：

- 模型生成 group summary
- 复杂跨页语义聚类
- 多轮 evidence cache

### Phase 4 文件级改造清单

#### 1. 新增 `src/evidence-pack.ts`

建议导出：

```ts
export type EvidenceGroupPurpose =
  | "definition"
  | "task_steps"
  | "prerequisite"
  | "overview"
  | "api_reference"
  | "constraint";

export type EvidenceGroup = {
  id: string;
  purpose: EvidenceGroupPurpose;
  path: string;
  heading?: string;
  citations: DocCitation[];
  summary: string;
  snippets: string[];
  score: number;
  platform?: "android" | "ios" | "web" | "flutter" | "general";
};

export type EvidenceTrimEvent = {
  reason: "group_budget" | "total_budget" | "dedupe";
  droppedGroupIds?: string[];
  droppedCitationCount?: number;
};

export type EvidencePack = {
  questionState: QuestionState;
  groups: EvidenceGroup[];
  warnings: string[];
  trimEvents: EvidenceTrimEvent[];
};

export function buildEvidencePack(params: {
  state: QuestionState;
  hits: DocSearchHit[];
  totalBudgetChars?: number;
  groupBudgetChars?: number;
}): EvidencePack;
```

#### 2. `src/evidence-pack.ts` 内部建议 helper

- `mergeAdjacentHits`
- `groupHitsByPurpose`
- `dedupeEvidenceGroups`
- `summarizeEvidenceGroup`
- `trimEvidencePack`
- `detectEvidenceWarnings`

#### 3. 修改 `src/question-execution.ts`

在 staged retrieval 之后新增：

```ts
const evidence = buildEvidencePack({
  state,
  hits,
});
```

然后：

- `onRetrieved` 仍然可回调原始 hits，保持现有 UI / preview 不崩
- 但真正的回答层逐步改为消费 `evidence`

#### 4. 修改 `src/doc-answer.ts`

这一期先做兼容过渡：

```ts
export async function buildDocAnswer(params: {
  runId: string;
  question: string;
  mode: DocAssistantMode;
  hits?: DocSearchHit[];
  evidence?: EvidencePack;
  ...
}): Promise<DocAnswerResult>
```

兼容规则：

- 有 `evidence` 时优先用 `evidence`
- 没有 `evidence` 时回退到 `hits`

#### 5. 修改 `src/openai-compatible.ts`

把 prompt 输入从平铺 hits 改成 evidence groups。

建议新增：

```ts
function buildEvidencePrompt(question: string, evidence: EvidencePack): string;
```

### Phase 4 预算与裁剪规则

建议默认预算：

- `totalBudgetChars = 5000`
- `groupBudgetChars = 1200`

裁剪顺序：

1. 去重复 snippets
2. 同页弱证据
3. 多余 `overview`
4. 多余 `api_reference`
5. 非核心 `prerequisite`

禁止裁剪的最低保留组：

- concept 至少保留 1 个 `definition` 或 `overview`
- procedural 至少保留 1 个 `task_steps`
- mixed 至少保留 1 个 `definition` 和 1 个 `task_steps`

### Phase 4 测试清单

新增 `src/evidence-pack.test.ts`：

- 相邻 chunk 合并
- 同页重复去重
- mixed 问题能同时产生 `definition` 和 `task_steps`
- 超预算时触发 trim event
- trim 后最低保留组仍存在

### Phase 4 完成定义

满足以下条件即可结束：

- 主回答链已经可以消费 `EvidencePack`
- evidence budget 和 trim event 已记录
- `openai-compatible.ts` 不再直接拼 raw hits
- mixed 问题的证据输入明显更规整

### Phase 4 回退策略

如果 evidence pack 让回答显著缺信息：

1. 保留 grouping
2. 暂时放宽 budget
3. 关闭 aggressive trim
4. 继续记录 trim event，先收集过裁样本

## Phase 5 详细实施蓝图

这一期要解决的是：回答层不能再同时做“规划”“写文案”“纠错”“澄清”。要把它拆成稳定的 planning 和 rendering。

### Phase 5 实现范围

第一版只拆两层：

- answer plan
- final render

第一版先不做：

- 复杂多轮 plan repair
- 多模型协作 render
- 单独的 plan cache

### Phase 5 文件级改造清单

#### 1. 新增 `src/answer-plan.ts`

建议导出：

```ts
export type AnswerSectionPlan = {
  title: string;
  purpose: "definition" | "steps" | "apis" | "notes" | "clarification" | "insufficient";
  evidenceGroupIds: string[];
};

export type AnswerPlan = {
  kind: "concept" | "guide" | "mixed" | "clarification" | "insufficient";
  sections: AnswerSectionPlan[];
  mustMention: string[];
  mustAvoid: string[];
};

export function buildAnswerPlan(params: {
  question: string;
  state: QuestionState;
  evidence: EvidencePack;
}): AnswerPlan;
```

#### 2. 新增 `src/answer-render.ts`

建议导出：

```ts
export function renderExtractiveAnswer(params: {
  question: string;
  state: QuestionState;
  plan: AnswerPlan;
  evidence: EvidencePack;
}): DocAnswerResult;

export function buildAgentPromptFromPlan(params: {
  question: string;
  state: QuestionState;
  plan: AnswerPlan;
  evidence: EvidencePack;
  draftAnswer: string;
}): string;
```

#### 3. 修改 `src/doc-answer.ts`

将 `buildDocAnswer(...)` 变成 facade：

1. 输入 `state + evidence`
2. `buildAnswerPlan(...)`
3. `renderExtractiveAnswer(...)`
4. 如果 mode 是 agent，再基于 plan + evidence render agent

建议新签名：

```ts
export async function buildDocAnswer(params: {
  runId: string;
  question: string;
  state?: QuestionState;
  mode: DocAssistantMode;
  hits?: DocSearchHit[];
  evidence?: EvidencePack;
  ...
}): Promise<DocAnswerResult>
```

### Phase 5 Answer Plan 规则

第一版 plan 规则建议：

- concept
  - `Definition`
  - `Key points`
  - `Notes`
- guide
  - `What you need`
  - `Steps`
  - `Key APIs or docs`
  - `Notes`
- mixed
  - `Definition`
  - `Steps`
  - `Key APIs or docs`
  - `Notes`

必须避免：

- concept answer 以 `Steps` 开头
- guide answer 只有背景说明，没有可执行步骤
- mixed answer 先写 procedural 再补定义

### Phase 5 测试清单

新增：

- `src/answer-plan.test.ts`
- `src/answer-render.test.ts`

覆盖：

- concept 计划结构
- guide 计划结构
- mixed 计划结构
- evidence trim warning 传入 agent prompt
- extractive render 的 section 顺序

### Phase 5 完成定义

满足以下条件即可结束：

- `doc-answer.ts` 不再自己硬编码全部回答结构
- plan 和 render 已可单独测试
- agent prompt 输入来自 plan + evidence，而不只是 raw hits

### Phase 5 回退策略

如果 plan 层引入后回答风格明显退化：

1. 保留 `answer-plan.ts`
2. extractive 继续走 plan
3. agent 暂时退回“grounded answer + evidence”模式
4. 等 validator 期一起收敛

## Phase 6 详细实施蓝图

这一期的关键不是“多一层检查”，而是把检查结果纳入正式状态流转。

### Phase 6 实现范围

第一版 validator 只处理规则型问题：

- 缺 citation
- citation topic mismatch
- 混平台
- client/server 混答
- 该澄清未澄清
- 结构不匹配
- 证据裁剪后表达过度确定
- procedural answer off-intent

第一版先不做：

- 模型评分
- 自我修复重生成
- 复杂事实核查

### Phase 6 文件级改造清单

#### 1. 新增 `src/answer-validator.ts`

建议导出：

```ts
export type AnswerValidationIssue = {
  code:
    | "missing_citation"
    | "citation_topic_mismatch"
    | "cross_platform"
    | "cross_api_layer"
    | "missing_clarification"
    | "section_mismatch"
    | "overclaim_after_trim"
    | "off_intent_answer";
  severity: "warn" | "error";
  message: string;
};

export type AnswerValidationResult = {
  ok: boolean;
  issues: AnswerValidationIssue[];
  downgradeTo?: "clarification" | "insufficient";
};

export function validateAnswer(params: {
  state: QuestionState;
  plan: AnswerPlan;
  evidence: EvidencePack;
  answer: string;
  summary: string;
}): AnswerValidationResult;
```

#### 2. 修改 `src/doc-answer.ts`

在 final answer 生成后增加：

1. `validateAnswer(...)`
2. 如果 `downgradeTo === "clarification"`：
   - 走 clarification render
3. 如果 `downgradeTo === "insufficient"`：
   - 走 insufficient answer render
4. 把 validator issues 写入 trace

#### 3. 修改 `src/eval.ts`

扩展 `EvalResult`：

```ts
type EvalResult = {
  ...
  validation?: {
    ok: boolean;
    issues: string[];
    downgradeTo?: string;
  };
};
```

并新增：

```ts
export function evaluateValidationCase(...)
```

### Phase 6 降级规则

建议第一版：

- `missing_clarification`
  -> `downgradeTo: "clarification"`
- `cross_platform`
  -> `downgradeTo: "clarification"`
- `cross_api_layer`
  -> `downgradeTo: "clarification"`
- `citation_topic_mismatch`
  -> `downgradeTo: "insufficient"`
- `overclaim_after_trim`
  -> `downgradeTo: "insufficient"`
- `off_intent_answer`
  -> `downgradeTo: "insufficient"`

不建议第一版自动降级的情况：

- 单个 citation 缺失
- notes section 不完整

### Phase 6 测试清单

新增 `src/answer-validator.test.ts`：

- answer 无 citation
- citation 存在但与句子主题不匹配
- Android 问题混入 iOS
- client 问题混入 server api
- evidence 已 trim 但答案仍说“文档明确说明”
- 应澄清但未澄清
- procedural question 命中相邻文档但答案偏题

扩展 `src/eval.test.ts`：

- validator issue 可进入报告
- downgrade 路径可被断言

### Phase 6 完成定义

满足以下条件即可结束：

- validator 结果不只是日志
- 错误类型可以触发正式降级
- eval 能区分 retrieval / answer / validation 三层结果

### Phase 6 回退策略

如果 validator 误伤过多：

1. 保留 validator report
2. 暂时关闭自动 downgrade
3. 先让它只作为 eval 和 trace 信息源
4. 待样本积累后再重新打开 downgrade

## Phase 3 到 Phase 6 联合验收命令

开发这几期时，建议固定跑这组命令：

```bash
cd learn/doc-assistant-design
npm run typecheck
npm test
npm test -- src/eval.test.ts
```

如果当期改动涉及对应新文件，提交前额外跑：

```bash
cd learn/doc-assistant-design
node --import ../gateway-design/node_modules/tsx/dist/loader.mjs --test \
  src/retrieval-plan.test.ts \
  src/doc-search.test.ts \
  src/evidence-pack.test.ts \
  src/answer-plan.test.ts \
  src/answer-render.test.ts \
  src/answer-validator.test.ts
```

## Phase 7 详细实施蓝图

这一期的目标是把“已经答过什么”和“应该怎么检索”分开。否则后续优化会一直把两类问题混在一起。

### Phase 7 实现范围

第一版 retrieval memory 只处理这些信息：

- preferred paths
- discouraged paths
- required clarification
- 适用的问题模式

第一版先不做：

- 自动学习
- 向量检索
- 复杂置信度融合

### Phase 7 文件级改造清单

#### 1. 新增 `src/retrieval-memory.ts`

建议导出：

```ts
export type RetrievalMemoryEntry = {
  entryId: string;
  questionPattern: string;
  normalizedQuestionPattern: string;
  preferredPaths: string[];
  discouragedPaths: string[];
  requiredClarification?: "platform" | "channel_kind" | "api_layer" | "product";
  createdAt: number;
  updatedAt: number;
  source: "manual" | "eval_tuning";
  note?: string;
};

export type RetrievalMemoryMatch = {
  entry: RetrievalMemoryEntry;
  score: number;
};

export async function loadRetrievalMemoryEntries(dataDir?: string): Promise<RetrievalMemoryEntry[]>;
export async function saveRetrievalMemoryEntries(
  entries: RetrievalMemoryEntry[],
  dataDir?: string,
): Promise<void>;
export async function findRetrievalMemoryMatch(params: {
  question: string;
  dataDir?: string;
}): Promise<RetrievalMemoryMatch | null>;
```

#### 2. 修改 `src/question-execution.ts`

接入点建议：

1. 在 staged retrieval 前查 retrieval memory
2. 命中后：
   - 写入 trace
   - 传给 retrieval plan 和 doc-search 用于加减分

不要做的事：

- 命中 retrieval memory 后直接跳过 retrieval
- 命中 retrieval memory 后直接生成答案

#### 3. 修改 `src/doc-search.ts`

新增可选参数：

```ts
type RetrievalOverrides = {
  preferredPaths?: string[];
  discouragedPaths?: string[];
};
```

在 `searchDocsForBucket(...)` / `searchDocsForPurpose(...)` 中接入路径加减分。

#### 4. 修改 `src/eval.ts`

允许在 eval 报告中打印：

- retrieval memory 是否命中
- 命中后带来了哪些 preferred / discouraged path

### Phase 7 测试清单

新增 `src/retrieval-memory.test.ts`：

- 路径读写
- 模式匹配
- preferred path 加分
- discouraged path 降分
- required clarification 暴露给 trace

### Phase 7 完成定义

满足以下条件即可结束：

- retrieval memory 已和 answer memory 分离
- retrieval memory 只影响检索，不直接替代答案生成
- eval / trace 能看到 retrieval memory 命中情况

### Phase 7 回退策略

如果 retrieval memory 让检索过拟合：

1. 保留存储结构
2. 降低 path override 权重
3. 只把 required clarification 保留下来
4. preferred / discouraged 暂时仅出现在 trace 中

## Phase 8 详细实施蓝图

这一期的目标是让评测结果能定位哪一层出了问题，而不是只输出“通过/失败”。

### Phase 8 实现范围

第一版 eval 分成四层：

- retrieval
- answer
- validation
- transition

### Phase 8 文件级改造清单

#### 1. 修改 `src/eval-cases.ts`

建议扩展 case 结构：

```ts
export type DocAssistantEvalCase = {
  ...
  expectedClarificationKind?: "platform" | "channel_kind" | "api_layer" | "product";
  expectedAnswerSections?: string[];
  requiredCitationPaths?: string[];
  forbiddenCitationPaths?: string[];
  expectedTransitions?: Array<
    "clarification_required" | "evidence_trimmed" | "validator_downgrade"
  >;
};
```

#### 2. 修改 `src/eval.ts`

建议把 `EvalResult` 扩成：

```ts
type EvalResult = {
  caseDef: DocAssistantEvalCase;
  passed: boolean;
  reasons: string[];
  retrieval: ...;
  answer?: string;
  summary?: string;
  validation?: {
    ok: boolean;
    issues: string[];
    downgradeTo?: string;
  };
  transitions?: string[];
};
```

并新增：

```ts
export function evaluateClarificationCase(...);
export function evaluateCitationCase(...);
export function evaluateTransitionCase(...);
```

#### 3. 修改 `src/smoke.ts`

为了让 eval 能看到更多内部信息，建议扩展 smoke 返回值：

```ts
{
  ...
  trace?: {
    clarificationKind?: string;
    transitions?: string[];
    validatorIssues?: string[];
  };
}
```

#### 4. 修改 `src/question-execution.ts`

为 smoke / eval 暴露最小必要 trace，不改变对外 HTTP 协议。

### Phase 8 样例覆盖要求

必须新增这些 case：

- generic channel creation
- generic connect
- mixed concept + procedural
- platform-only follow-up
- client/server ambiguity
- evidence trimmed but still answerable
- validator downgrade to clarification
- validator downgrade to insufficient

### Phase 8 完成定义

满足以下条件即可结束：

- eval 能明确指出失败在 retrieval / answer / validation / transition 哪层
- smoke 返回足够的信息支持调试
- 不需要人工看完整回答才能定位问题

### Phase 8 回退策略

如果 eval 变得过脆：

1. 优先保留 transition / validation 结果
2. 降低 answer 文案层强匹配
3. 更多使用 section、keyword、citation 断言

## Phase 9 详细实施蓝图

这一期是结构增强期，目标是让索引表达更接近文档真实结构，为检索和证据编译提供更高质量原料。

### Phase 9 实现范围

第一版只增强：

- `pageTitle`
- `sectionLevel`
- `chunkKind`
- `symbols`

第一版先不做：

- 复杂 Markdown AST 持久化
- 表格结构化解析
- 页面关系图

### Phase 9 文件级改造清单

#### 1. 修改 `src/doc-index.ts`

建议把 `DocIndexChunk` 扩为：

```ts
export type DocIndexChunk = {
  id: string;
  relativePath: string;
  pageTitle?: string;
  heading?: string;
  sectionLevel?: number;
  chunkKind: "heading_body" | "list_step" | "code_block" | "frontmatter_summary";
  startLine: number;
  endLine: number;
  text: string;
  tokens: string[];
  symbols?: string[];
};
```

建议新增 helper：

- `extractPageTitle`
- `extractSectionLevel`
- `detectChunkKind`
- `extractSymbols`

#### 2. 修改 `src/doc-search.ts`

接入新字段进行打分：

- `list_step` 对 procedural 加分
- `frontmatter_summary` 对 overview / definition 加分
- `symbols` 与问题中的 API 词项匹配时加分

#### 3. 修改 `src/evidence-pack.ts`

优先选择：

- procedural -> `list_step`
- concept -> `frontmatter_summary` / `heading_body`
- api_reference -> `code_block` / `symbols`

### Phase 9 测试清单

新增 `src/doc-index.test.ts`：

- frontmatter summary 提取
- step heading 提取
- code symbol 提取
- chunkKind 识别

扩展 `src/doc-search.test.ts`：

- procedural 问题优先 `list_step`
- API 问题能命中 symbol 更强的 chunk

### Phase 9 完成定义

满足以下条件即可结束：

- `DocIndexChunk` 已具备更强结构信息
- `doc-search.ts` 和 `evidence-pack.ts` 已消费这些结构
- procedural / API 问题的命中质量明显提高

### Phase 9 回退策略

如果 chunk 结构增强引发大量基线波动：

1. 保留新增字段
2. 暂时降低它们在打分中的权重
3. 先以 trace 输出方式观察，不立即让其主导排序

## 稳定运行要求

用户要求不是只写出好看的架构，而是让系统稳定运行。这一条要显式写进计划里。

### 运行稳定性目标

至少满足：

- 单轮 ask 不因 trace / eval / validator 附带逻辑而阻塞或超时
- follow-up store 损坏时不会导致主链崩溃
- retrieval memory / answer memory 文件缺失时可以安全回退
- evidence trim 不会导致空回答
- validator 误判时可关闭 downgrade，不影响主链可用性

### 工程要求

1. 所有新增层都要有安全回退：
   - state build 失败 -> 回退原 question
   - clarification policy 失败 -> 回退不澄清
   - retrieval plan 失败 -> 回退单次 `searchDocs`
   - evidence pack 失败 -> 回退 raw hits
   - validator 失败 -> 回退只记录 issue

2. 所有新层都要可观察：
   - trace 文件可看到各阶段输入输出摘要

3. 所有新层都要可单测：
   - 尽量用纯函数
   - 尽量避免 IO 和主流程耦合

### 最终落地标准

只有同时满足下面两类标准，才算这份计划执行完成：

1. 回答质量标准
   - 文档内的常见问题能稳定命中正确证据
   - 模糊问题优先澄清，不乱猜
   - 多轮 follow-up 能保持上下文

2. 系统稳定性标准
   - 主链无单点新模块导致不可用
   - 所有增强层都可降级
   - smoke / eval / test 能持续帮助定位问题

## 核验后补齐的关键工程项

重新对照当前代码后，下面这些项必须显式写进计划，否则“回答更准”和“系统稳定运行”都容易在中后期卡住。

### 工程项 1：索引生命周期与缓存策略

当前 `src/doc-index.ts` 的 `buildDocIndex(...)` 会在主调用链里重建索引。若后续引入 staged retrieval、evidence pack、validator，但没有补索引生命周期策略，系统会出现两个问题：

- 每轮问答重复扫盘，性能抖动大
- 索引结构增强后，重建成本继续上升

必须补齐：

- 索引缓存策略
- 文档变更后的失效策略
- 索引 schema version
- index rebuild trace

建议新增 Phase 0.x 工程任务：

```ts
type DocIndexMetadata = {
  schemaVersion: string;
  docsRoot: string;
  builtAt: number;
  fileCount: number;
  contentHash?: string;
};
```

建议新增能力：

- `loadCachedDocIndex(...)`
- `isDocIndexFresh(...)`
- `rebuildDocIndexIfNeeded(...)`

涉及文件：

- `src/doc-index.ts`
- `src/question-execution.ts`
- `src/smoke.ts`

### 工程项 2：持久化写入必须原子化

当前这些模块都会写 JSON / JSONL：

- `src/follow-up-context.ts`
- `src/answer-memory.ts`
- 后续的 `src/retrieval-memory.ts`

如果不补原子写入和损坏恢复，系统在中断或并发写时会出现状态损坏，直接影响稳定运行。

必须补齐：

- 原子写入 helper
- 读失败时的损坏降级
- 最小恢复策略

建议新增：

- `src/persistence.ts`

建议导出：

```ts
export async function writeJsonAtomic(path: string, value: unknown): Promise<void>;
export async function appendJsonlAtomic(path: string, line: unknown): Promise<void>;
export async function readJsonSafe<T>(path: string, fallback: T): Promise<T>;
```

涉及文件：

- `src/follow-up-context.ts`
- `src/answer-memory.ts`
- `src/retrieval-memory.ts`

### 工程项 3：阶段开关和快速回退机制

现在计划里写了很多“回退策略”，但代码层还没有统一开关。要让系统稳定运行，必须给新能力明确 feature toggle。

必须补齐：

- question state toggle
- clarification policy toggle
- staged retrieval toggle
- evidence pack toggle
- validator downgrade toggle

建议新增：

- `src/feature-flags.ts`

建议导出：

```ts
export type DocAssistantFeatureFlags = {
  questionState: boolean;
  clarificationPolicy: boolean;
  stagedRetrieval: boolean;
  evidencePack: boolean;
  validator: boolean;
  validatorDowngrade: boolean;
};

export function getDocAssistantFeatureFlags(): DocAssistantFeatureFlags;
```

涉及文件：

- `src/question-execution.ts`
- `src/doc-answer.ts`
- `src/eval.ts`

### 工程项 4：并发与幂等性验证

`docs.ask` 现在有 runId、session、history、memory、follow-up store。后续加更多层之后，需要明确这些写操作在并发 ask 时的行为。

必须补齐：

- 同一 `sessionId` 连续提问的状态一致性
- 同一 `idempotencyKey` 的幂等行为不倒退
- 多个 run 同时写 history / follow-up / memory 时不互相污染

建议新增测试：

- `src/concurrency.test.ts`

最低覆盖：

- 同 session 快速连续提问
- follow-up 与新问题交叉
- memory enqueue 和 history write 并发

### 工程项 5：质量门槛必须分成本地 gate 和回归 gate

要让后续实现可持续推进，计划里应明确不同阶段的 gate，而不是只说“跑 test / eval”。

建议固定两层 gate：

1. 本地开发 gate
   - `npm run typecheck`
   - `npm test`

2. 问答回归 gate
   - `npm test -- src/eval.test.ts`
   - 选定文档集上的 `npm run eval`

建议把每一期都标注：

- 最低 gate
- 提交前 gate
- 方案切换时的对比 gate

### 工程项 6：需要一份稳定 smoke 语料

现在 eval case 已经不少，但如果后续要长期维护系统，还需要一份更小的、固定的 smoke 集，保证每次改动都能快速验证主链。

建议新增：

- `src/smoke-cases.ts`

覆盖：

- greeting
- platform clarification
- channel kind clarification
- api layer clarification
- concept answer
- procedural answer
- mixed answer
- follow-up continuation

### 工程项 7：trace 结构必须先定义 schema

计划多处提到 trace，但现在还没有统一 schema。没有 schema，后续 trace 很容易变成临时日志堆。

建议新增：

- `src/trace.ts`

建议定义：

```ts
export type DocAssistantTrace = {
  runId: string;
  question: string;
  state?: unknown;
  route?: string;
  clarification?: unknown;
  retrieval?: unknown;
  evidence?: unknown;
  validation?: unknown;
  transitions: string[];
  createdAt: number;
};
```

要求：

- 先保证 machine-readable
- 人类可读摘要可以后补

## 每期实施顺序

推荐实际顺序：

1. Phase 0
2. Phase 0.x
3. 工程项 1：索引生命周期与缓存策略
4. 工程项 2：持久化写入必须原子化
5. 工程项 3：阶段开关和快速回退机制
6. Phase 1
7. Phase 2
8. Phase 3
9. Phase 4
10. Phase 5
11. Phase 6
12. Phase 8
13. Phase 7
14. Phase 9

说明：

- `Phase 8` 提前于 `Phase 7`，因为先把 eval 拉起来，再做 retrieval memory，调优效率更高
- `Phase 9` 放最后，因为索引增强会带来较多基线波动
- 工程基础项放在前面，是为了避免后续所有能力都建立在易损的索引和持久化链路之上
- `Phase 0.x` 提前，是因为 answer surface trust 和 prompt contract 不修，后续所有 eval 与 agent 观察都会继续被污染

## 事故驱动优先补丁序列

针对这次 `How to change the default language for push notification?` 事故，建议按下面顺序优先落地，不等待全部 Phase 完成：

1. 修 `Phase 0.x`
   - 先让 mock / embedded surface 不再污染答案评估
   - 先让 prompt echo 不再被 parser 接收

2. 在 `src/question-execution.ts` 中补 answerability gate
   - `searchDocs(...)` 后先做 `answerable | needs_clarification | insufficient_evidence` 判定
   - 没通过就不进入 `buildDocAnswer(...)`

3. 在 `src/doc-search.ts` 中加 must-cover anchors
   - 第一批至少覆盖 `language` / `locale` / `localization` / `default language`
   - 相邻 Android push 文档只能作为 adjacent evidence，不能直接成为主答案来源

4. 落 `Phase 6` 的 validator 最小闭环
   - 第一批先把 `citation_topic_mismatch` 和 `off_intent_answer` 做起来
   - 即使生成出“结构完整”的答案，也要能降级成 insufficient

5. 把本次事故写成 eval case
   - retrieval fail case
   - answerability fail case
   - validator downgrade case
   - prompt echo invalid case

这样做的目的不是跳过主计划，而是先把当前最危险的假阳性路径切断。

## 每期提交建议

建议按下面粒度提交：

1. `Doc Assistant: add question state model`
2. `Doc Assistant: add clarification policy`
3. `Doc Assistant: add staged retrieval planning`
4. `Doc Assistant: compile evidence packs before answer generation`
5. `Doc Assistant: split answer planning and rendering`
6. `Doc Assistant: validate answers before returning`
7. `Doc Assistant: expand eval coverage for clarification and citations`
8. `Doc Assistant: add retrieval memory layer`
9. `Doc Assistant: enrich document index structure`

## 推荐验证命令

每一期至少跑：

```bash
cd learn/doc-assistant-design
npm test
npm run typecheck
```

涉及评测策略时再跑：

```bash
cd learn/doc-assistant-design
npm run eval -- --docs-root <docs-root>
```

如果修改了 HTTP / method / run 语义，额外跑：

```bash
cd learn/doc-assistant-design
npm test -- src/http.test.ts
```

如果修改了检索：

```bash
cd learn/doc-assistant-design
npm test -- src/eval.test.ts
```

## 风险清单

### 风险 1：问题状态过度设计

控制方式：

- 第一版只落最关键槽位
- 先服务 platform / channel kind / api layer

### 风险 2：检索策略分层后性能变差

控制方式：

- expansion retrieval 默认限制上限
- trace 记录每轮检索次数和命中数

### 风险 3：agent prompt 变复杂后漂移更大

控制方式：

- 先本地生成 answer plan
- 模型只负责 render，不负责自由规划

### 风险 4：eval 断言太脆

控制方式：

- 优先校验结构和关键词
- 避免对完整自然语言文案做强匹配

## 第一阶段的直接落地范围

如果现在就开工，建议先只做下面这组最小闭环：

1. 新增 `src/question-state.ts`
2. 扩展 `src/follow-up-context.ts` 支持更完整 state
3. 新增 `src/clarification-policy.ts`
4. 修改 `src/question-execution.ts` 先走统一 state + clarification
5. 补 `question-state` 与 `clarification` 测试
6. 扩展 `eval-cases.ts` 增加 channel kind / api layer 相关 case

这组改造能直接解决最明显的问题，而且不会一下子把 `doc-search.ts` 和 `doc-answer.ts` 全部推倒。

如果按这次事故优先级执行，建议把最小闭环改成：

1. Phase 0.x
2. `search -> answerability decision -> answer` 这条主链改造
3. must-cover anchors 的最小版
4. validator 最小闭环
5. 对应 eval case 全补齐

这组改造能更直接解决“看起来答了，实际完全偏题”的高风险问题。

## 完成标准

本轮改造完成，不以“写完所有新文件”为标准，而以这五条为标准：

- 泛化问题在缺关键信息时能稳定澄清
- 多轮 follow-up 不只支持平台
- 回答层输入已经从原始 hits 升级到 evidence pack
- eval 能发现澄清错误、混平台错误和缺引用错误
- 主链代码职责明显比当前更清晰

还必须额外满足这四条：

- mock / embedded surface 不再作为答案质量通过依据
- prompt echo 不再可能伪装成成功答案
- 无法覆盖核心 intent 的检索结果会触发 insufficient / clarification，而不是直接给步骤
- 有 citation 但明显偏题的答案会被 validator 拦住

## 最终验收 Checklist

以下 checklist 用于逐项核验这份计划是否已经执行完成。

### 当前执行状态（2026-04-02）

截至本次实现与核验，下面这份 checklist 已全部完成。

- 已落地：
  - `QuestionState`
  - `ClarificationPolicy`
  - staged retrieval
  - `EvidencePack`
  - answerability gate
  - `answer-plan`
  - `answer-render`
  - `answer-validator`
  - `retrieval-memory`
  - `feature-flags`
  - `persistence`
  - `trace`
  - `smoke-cases`
  - 索引生命周期与缓存
- 已验证：
  - `npm run typecheck` 通过
  - `npm test` 全量通过
  - `npm run eval -- --report-file .tmp-eval-report.json` 通过，结果 `47/47`
  - `npm run eval -- --docs-root /Users/admin/Workspace@RongCloud/For-production/rc-new/docs --report-file .tmp-eval-report-real-docs.json` 通过，结果 `47/47`
- 额外说明：
  - `prompt echo invalid case` 通过 `src/eval.test.ts` 与 `src/index.test.ts` 的 output-contract 回归测试覆盖，而不是 docs corpus eval case。
  - 当前 OpenClaw 仓库自己的 `docs/` 不是这套 Chat/Call SDK eval case 的目标语料；本计划里的 “真实 docs-root” 指的是实际 SDK 文档语料根目录。

### A. 评测面与输出契约

- [x] `embedded + mock/learning-*` 已被标记为 `non_authoritative`
- [x] eval / smoke 不再把 `non_authoritative` surface 当成答案质量通过样本
- [x] trace 中可看到 `answerSurface.kind` 和 `answerSurface.trust`
- [x] `doc-answer.ts` 不再把 draft answer 放进可被 parser 接收的 sentinel 区域
- [x] prompt 原样回显不会被识别为最终答案
- [x] openai-compatible 路径与本地 agent 路径使用一致的 output contract 原则

### B. Question Understanding 与 Clarification

- [x] `QuestionState` 已落地并进入主编排
- [x] follow-up context 已持久化关键 state，而不只保存 platform
- [x] clarification policy 已独立成层，不再散落在 `doc-answer.ts`
- [x] 平台、channel kind、api layer 缺失时能稳定触发澄清

### C. Retrieval 与 Answerability

- [x] 检索已从单次 top hits 升级为 staged retrieval
- [x] retrieval plan 能区分 primary 和 expansion
- [x] retrieval trace 能解释 primary / expansion 命中
- [x] 检索已支持 must-cover anchors
- [x] answerability gate 已在 `search -> answer` 之间生效
- [x] 命中相邻文档但无法覆盖核心 intent 时，会降级到 clarification 或 insufficient

### D. Evidence 与 Rendering

- [x] `EvidencePack` 已成为回答主输入，而不是 raw hits
- [x] evidence pack 支持分组、去重、summary、budget、trim trace
- [x] answer plan 与 render 已拆开并可单测
- [x] agent prompt 输入来自 plan + evidence，而不是 raw hits 平铺

### E. Validation 与 Downgrade

- [x] `answer-validator.ts` 已落地
- [x] validator 支持 `missing_clarification`
- [x] validator 支持 `cross_platform`
- [x] validator 支持 `cross_api_layer`
- [x] validator 支持 `citation_topic_mismatch`
- [x] validator 支持 `off_intent_answer`
- [x] validator issue 能触发 clarification / insufficient downgrade
- [x] validator 结果会进入 trace 与 eval 报告

### F. Memory 与 Trace

- [x] retrieval memory 与 answer memory 已拆分
- [x] retrieval memory 可影响加减分，但有 trace 可解释
- [x] trace schema 已统一定义，不是临时日志堆
- [x] trace 至少覆盖 state、retrieval、evidence、validation、memory 五类信息

### G. Eval 与 Regression

- [x] eval 已能分别报告 retrieval / answer / validation 三层 verdict
- [x] 本次 `push notification language` 事故已被写成正式 eval case
- [x] prompt echo invalid case 已加入 eval
- [x] adjacent-doc / off-intent procedural case 已加入 eval
- [x] platform clarification 和 api-layer clarification case 已加入 eval

### H. 工程与运行稳定性

- [x] 索引生命周期与缓存策略已落地
- [x] 持久化写入具备原子性
- [x] 阶段开关和快速回退机制已存在
- [x] evidence overflow 不会导致空回答
- [x] validator 误判时可关闭自动 downgrade 而不影响主链可用性

### I. 最终效果验收

- [x] 泛化问题在缺关键信息时会先澄清
- [x] 多轮 follow-up 不只支持平台
- [x] 概念题不再硬套步骤结构
- [x] 步骤题不再基于相邻文档胡乱补全
- [x] mixed question 能先定义再步骤
- [x] insufficient evidence 会被明确说出，不再编造
- [x] 有 citation 但偏题的答案会被拦截
- [x] 系统在真实 docs-root 上可稳定跑通 `npm test`、`npm run typecheck`、`npm run eval -- --docs-root <docs-root>`
