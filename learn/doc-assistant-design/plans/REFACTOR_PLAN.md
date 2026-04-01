# Learn Doc Assistant Refactor Plan

## 目标

本计划把 `learn/doc-assistant-design` 从“可运行的 learning demo”整理成一套更稳定的文档助手控制面架构，同时保持现有外部协议和学习价值不被破坏。

重构目标：

- 保持 `docs.*` RPC 和现有 HTTP/WS 访问方式基本不变。
- 把 transport、run lifecycle、pipeline、answer engine、post-run hooks 分层。
- 给 agent mode 增加更清晰的运行边界。
- 让后续功能可以按层扩展，而不是继续堆进 `methods/docs.ts`、`question-execution.ts`、`doc-answer.ts`。

非目标：

- 不把项目改造成通用 agent 平台。
- 不引入插件系统、MCP、复杂权限系统。
- 不重做前端 UI。
- 不做破坏性协议升级。

## 当前问题

当前实现已经能工作，但职责有几处耦合较重：

- `src/methods/docs.ts`
  同时负责 RPC 入参校验、run 生命周期、事件广播、transcript 写入、session 更新、history 落盘。
- `src/question-execution.ts`
  同时负责问题改写、follow-up 复用、answer memory 命中、检索执行、answer route 决策。
- `src/doc-answer.ts`
  同时负责 extractive answer、agent mode、OpenAI-compatible 调用、delta 流式处理。
- `src/server-runtime-state.ts`
  只有低层状态容器，没有清晰的 run service、event bus、hook runner 抽象。

结果是：

- 新策略很容易继续叠到主路径里。
- 单测边界不够清晰。
- agent mode 的演进空间有限。
- 回答完成后的沉淀逻辑只能继续塞进主流程。

## 目标结构

建议逐步收敛到下面这套结构：

```text
learn/doc-assistant-design/src/
  transport/
    http-api.ts
    ws-runtime.ts
    method-router.ts
    methods/
      docs.ts

  application/
    ask/
      DocAskService.ts
      AskPipeline.ts
      types.ts
      steps/
        rewriteQuestionStep.ts
        memoryLookupStep.ts
        retrievalStep.ts
        clarificationStep.ts
        answerStep.ts
        postProcessStep.ts
    runs/
      RunRegistry.ts
    hooks/
      PostRunHookRunner.ts
      hooks/
        AnswerMemoryHook.ts
        SessionSummaryHook.ts
        QualitySignalHook.ts
    events/
      EventBus.ts

  domain/
    retrieval/
      doc-index.ts
      doc-search.ts
    answer/
      extractive-answer-engine.ts
      agent-answer-engine.ts
      openai-compatible.ts
    followup/
      clarification.ts
    memory/
      answer-memory.ts

  infra/
    store/
      user-store.ts
      session-store.ts
      transcript-store.ts
      question-history-store.ts

  agent/
    doc-agent-runtime.ts
    doc-agent-tools.ts
    doc-agent-types.ts
```

说明：

- 这是目标结构，不要求第一期一次性到位。
- 前几期可以先通过 facade 或 wrapper 过渡，避免大规模 rename。

## 分期计划

### Phase 0: 基线固化

目标：

- 在动结构前先固定当前行为，避免重构期间无意改语义。

范围：

- 补充和梳理现有测试。
- 明确哪些行为必须保持不变。

具体工作：

- 盘点 `src/http.test.ts`、`src/index.test.ts`、`src/cli.test.ts`、`src/eval.test.ts` 覆盖的行为。
- 增加最关键的回归测试：
  - `docs.ask` accepted -> completed
  - `docs.run.wait`
  - `docs.session.transcript.get`
  - `docs.history.list`
  - agent mode delta 事件
  - clarification follow-up 复用
  - answer memory 命中
- 记录当前协议和关键响应字段，作为迁移基线。

产出：

- 回归用例补齐。
- 一份“必须不变的外部行为”列表。

验收标准：

- 当前测试全部通过。
- 新增测试能覆盖主链路成功、失败、agent、follow-up 四类场景。

风险：

- 如果没有先补基线，后续每一期都很难判断是“清理结构”还是“改行为”。

### Phase 1: 抽出 DocAskService

目标：

- 先把 `methods/docs.ts` 从“大而全的 handler”变成“薄 transport 层”。

范围：

- 新增 application service。
- 不改现有协议，不改 answer 策略，不改检索逻辑。

建议新增文件：

- `src/application/ask/DocAskService.ts`
- `src/application/ask/types.ts`

建议迁移职责：

- 从 `src/methods/docs.ts` 移出：
  - run 创建与完成
  - transcript 写入
  - session 更新
  - history 落盘
  - retrieval / delta / completed 事件广播

`methods/docs.ts` 保留：

- 参数校验
- auth / scope
- 调 service
- 把 service 结果转成 wire response

产出：

- `docsAskHandler` 明显变薄。
- `launchDocAssistantRun()` 的逻辑迁到 service。

验收标准：

- 外部 RPC 行为不变。
- `src/http.test.ts` 无需改调用方式。
- `methods/docs.ts` 主要只剩校验和调用。

风险：

- 这一期最容易把 “transport concern” 和 “application concern” 再次混回去。

### Phase 2: 抽出 AskPipeline

目标：

- 把 `question-execution.ts` 里的策略流程显式化。

范围：

- 不改变实际策略顺序，只改变组织方式。

建议新增文件：

- `src/application/ask/AskPipeline.ts`
- `src/application/ask/steps/rewriteQuestionStep.ts`
- `src/application/ask/steps/memoryLookupStep.ts`
- `src/application/ask/steps/retrievalStep.ts`
- `src/application/ask/steps/clarificationStep.ts`
- `src/application/ask/steps/answerStep.ts`
- `src/application/ask/steps/postProcessStep.ts`

建议的 pipeline 顺序：

1. rewrite
2. memory lookup
3. retrieval
4. clarification decision
5. answer generation
6. post process

建议的上下文对象：

```ts
type AskContext = {
  command: DocAskCommand;
  rewrittenQuestion?: string;
  followUpSource?: string;
  route?: "greeting" | "memory" | "search";
  memoryMatch?: unknown;
  hits: DocSearchHit[];
  clarification?: unknown;
  answer?: DocAnswerResult;
};
```

产出：

- `question-execution.ts` 变成 facade 或被替换成 pipeline 入口。
- 每一步可以单独测试。

验收标准：

- follow-up / greeting / memory / search 四类路径行为保持一致。
- pipeline step 级别有独立测试。

风险：

- 如果一开始就过度抽象，会让 learning 包难读。
- 每个 step 要保持“窄职责”，不要又演变成新的大文件。

### Phase 3: 拆出 Answer Engines

目标：

- 把 `doc-answer.ts` 拆成两个清晰的 answer engine。

范围：

- extractive mode
- agent mode
- OpenAI-compatible 分流
- delta 处理

建议新增文件：

- `src/domain/answer/extractive-answer-engine.ts`
- `src/domain/answer/agent-answer-engine.ts`
- `src/domain/answer/types.ts`

保留或过渡：

- `src/doc-answer.ts` 可先保留为 facade，统一导出 `buildDocAnswer()`，内部再委托给两个 engine。

重构原则：

- extractive engine 只关心 grounded answer 和 citation 组合。
- agent engine 只关心 agent runtime、delta、provider/model 透出。
- route 选择留在 pipeline，不留在 engine 内部。

产出：

- extractive / agent 的边界清晰。
- `buildDocAnswer()` 不再承载所有策略分支。

验收标准：

- 现有 `buildDocAnswer` 相关测试继续通过。
- agent mode 的 selected provider/model 和 delta 行为不回退。

风险：

- 如果 route 逻辑还停留在 engine 内部，拆文件后仍然耦合。

### Phase 4: 引入 PostRunHookRunner

目标：

- 把回答完成后的沉淀逻辑从主请求路径中剥离出来。

范围：

- 不改变主回答结果。
- 让额外沉淀行为异步执行。

建议新增文件：

- `src/application/hooks/PostRunHookRunner.ts`
- `src/application/hooks/hooks/AnswerMemoryHook.ts`
- `src/application/hooks/hooks/SessionSummaryHook.ts`
- `src/application/hooks/hooks/QualitySignalHook.ts`

建议首批 hooks：

- `AnswerMemoryHook`
  - 把高质量回答写入 review queue 候选
- `SessionSummaryHook`
  - 为 follow-up 复用生成更稳的 session 摘要
- `QualitySignalHook`
  - 记录 memory hit、clarification、citation count、no-hit 等结构化信号

原则：

- hook 失败不能影响主请求结果。
- hook 不写入真实用户 transcript。
- hook 的输出尽量结构化。

产出：

- 主路径只负责回答和持久化主结果。
- 沉淀逻辑通过独立 runner 执行。

验收标准：

- 主请求成功时，即使 hook 报错，也不会变成 error terminal。
- 新增测试验证 hook 异步触发且不阻塞 `docs.completed`。

风险：

- 如果 hook 里继续复用主路径对象并隐式改状态，隔离会失效。

### Phase 5: 轻量 DocAgent Runtime

目标：

- 给 agent mode 增加更清晰的运行时边界。

范围：

- 保留现有 `runLearningAgentCommand()` 作为底层执行器。
- 但在文档助手层面把 agent 能力显式约束成一组“文档工具”。

建议新增文件：

- `src/agent/doc-agent-runtime.ts`
- `src/agent/doc-agent-tools.ts`
- `src/agent/doc-agent-types.ts`

建议的最小工具集：

- `search_docs`
- `read_doc_chunk`
- `get_answer_memory`
- `request_clarification`

不建议这一期做的工具：

- `write_doc`
- `browse_web`
- `exec_shell`
- `edit_file`

产出：

- agent mode 不再只是“大 prompt + 通用 agent”。
- tool trace 更可解释。

验收标准：

- agent mode 仍能回答当前覆盖的问题。
- 失败场景更容易解释为“检索不到”还是“推理不足”。
- 为后续多步文档问答扩展留出清晰接口。

风险：

- 如果工具设计过多，会把 learning 包推向通用 agent 平台。
- 如果工具太少，agent mode 价值又会不足。

### Phase 6: 目录收敛与命名整理

目标：

- 在主要职责稳定后再整理目录和命名，避免过早 rename。

范围：

- transport/application/domain/infra/agent 目录重组
- facade 文件保留一段时间，减少 import 冲击

建议操作：

- 保留旧入口文件作为 compatibility facade
- 在 README 中更新推荐阅读顺序
- 用分期 PR 的方式做 rename，不和逻辑变更混在一起

产出：

- 目录和职责对应关系更清晰。
- learning 包的教学价值更高。

验收标准：

- 主要 import 路径稳定。
- README 的结构图和代码目录一致。

风险：

- 如果把 rename 和行为变更混在一个阶段，会让 review 和回归都变难。

## 每期建议提交策略

建议每一期单独提交，尽量遵守：

- 一个阶段只解决一类结构问题。
- 不把 rename、抽象、行为调整、测试补齐全部揉进同一个提交。
- 每期都有清晰的“对外不变项”和“内部变化项”。

推荐顺序：

1. 基线补测
2. `DocAskService`
3. `AskPipeline`
4. `AnswerEngine`
5. `PostRunHooks`
6. `DocAgentRuntime`
7. 目录整理

## 每期回归清单

每一期结束都建议至少回归这些：

- `docs.ask` accepted / completed / error
- `docs.run.status`
- `docs.run.wait`
- `docs.session.transcript.get`
- `docs.history.list`
- `docs.search.preview`
- clarification follow-up
- answer memory 命中
- agent mode delta 输出
- OpenAI-compatible provider/model 透出

## 第一阶段落地建议

如果现在就开始动代码，建议先做 `Phase 1`，不要直接改 `question-execution.ts` 或 `doc-answer.ts`。

原因：

- `methods/docs.ts` 当前最明显地混了 transport 和 application。
- 抽出 `DocAskService` 的收益立刻可见。
- 风险比直接动 pipeline 和 answer engine 小得多。

第一阶段的最小可执行目标：

- 新建 `src/application/ask/DocAskService.ts`
- 把 `launchDocAssistantRun()` 及其依赖的 run lifecycle 逻辑迁进去
- `src/methods/docs.ts` 改成 thin handler
- 现有测试全绿

## 结论

这次重构应该遵循的原则是：

- 先稳外部行为，再拆内部结构。
- 先抽 service，再抽 pipeline，再拆 engine。
- 把后台沉淀逻辑做成 hooks，而不是继续塞进主流程。
- agent mode 只做文档助手需要的最小 runtime，不做通用平台。

如果按这个顺序推进，`learn/doc-assistant-design` 最终会从“一个已经可用的 demo”升级成“一套结构清晰、可持续演进、仍然适合教学的文档助手控制面样例”。
