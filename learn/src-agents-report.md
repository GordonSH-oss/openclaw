# OpenClaw `src/agents` 深读报告

## 1. 模块定位

`src/agents` 是 OpenClaw 的 agent 执行子系统。它不是单一“调用模型”的薄封装，而是一层分层很深的运行时编排栈，负责把一次 agent turn 从“外部请求”推进到“真正执行”，并在过程中解决下面这些核心问题：

- 当前要跑哪个 agent、哪个 session
- 使用哪种执行后端
- 使用哪个模型、思考强度和超时策略
- 使用哪组认证资料与 failover 顺序
- 当前工作区能加载哪些 skills、tools、sandbox 能力
- transcript、可见输出、错误和重试如何落盘与回传

如果从职责看，`src/agents` 更像“执行中枢”而不是“模型 SDK 层”。模型只是其中一个环节；真正复杂的是执行路径选择、上下文装配、权限与技能边界、运行时 failover，以及和 Gateway / session / transcript 的协同。

## 2. 目录结构总览

`src/agents` 里最重要的几个层次如下：

- `agent-command.ts`
  - agent turn 的总入口，负责把外部调用请求转成一次完整执行尝试。
- `command/`
  - 命令级执行编排，负责 session 上下文、attempt 生命周期、结果回传。
- `pi-embedded-runner/`
  - 内嵌 Pi agent runtime，是最重、最复杂的执行后端。
- `cli-runner/`
  - CLI 型 agent 后端，适合通过外部 CLI / 子进程跑 agent。
- `auth-profiles/`
  - 认证资料编排层，负责 profile 顺序、冷却、OAuth、状态观察与 session override。
- `skills/`
  - workspace skill 加载和 prompt 注入逻辑。
- `sandbox/`
  - sandbox 后端抽象，目前是可插拔架构。
- `tools/`
  - agent 可调用工具的注册、封装和运行支撑。
- `schema/`
  - 输入输出 schema 与协议辅助定义。
- `pi-extensions/`、`pi-embedded-helpers/`
  - 为 embedded runtime 提供上下文裁剪、辅助工具和扩展点。

从架构上看，这套代码分成三层最容易理解：

1. 顶层编排层
   - `agent-command.ts`
   - `command/*`
2. 执行后端层
   - `cli-runner/*`
   - `pi-embedded-runner/*`
3. 支撑能力层
   - `auth-profiles/*`
   - `skills/*`
   - `sandbox/*`
   - `tools/*`

## 3. 主执行链路

一次标准 agent 执行，大致沿着下面的链路前进：

1. 外部入口调用 `src/agents/agent-command.ts`
2. 入口先校验 message / target / session / config
3. 解析模型、思考等级、超时、verbosity、workspace、skill snapshot
4. 通过 `runWithModelFallback(...)` 建立模型候选与失败回退策略
5. 进入 `src/agents/command/attempt-execution.ts`
6. `attempt-execution.ts` 决定实际执行后端：
   - `runCliAgent(...)`
   - `runEmbeddedPiAgent(...)`
7. 执行过程中持续收集 visible text、tool 事件、transcript 片段
8. attempt 结束后把结果、错误、摘要、会话变更落到 session / transcript 层

这里有两个关键点：

- `agent-command.ts` 不是“真执行器”，它更像总调度器。
- 真正的复杂执行逻辑在 `pi-embedded-runner/`，而不是入口文件本身。

## 4. 关键入口文件解读

### 4.1 `src/agents/agent-command.ts`

这是整个 agents 子系统最值得先读的文件之一。它做的事不是模型调用，而是“把一次模糊的 agent 请求，收束成一个可执行计划”。

它主要负责：

- 校验消息内容与目标 agent
- 解析 config、secret ref 和 session 绑定
- 解析模型、thinking、timeout 等运行参数
- 构建 skills snapshot
- 应用 verbose / 可见输出策略
- 使用 `runWithModelFallback(...)` 包装执行
- 把真正执行委托给 `runAgentAttempt(...)`

理解这个文件的最佳方式，是把它看成“执行前的全部准备工作集合”。

### 4.2 `src/agents/command/attempt-execution.ts`

这个文件是执行分叉点。它的核心价值不在算法，而在于它把统一的上层请求，分发到不同执行后端，并维持一次 attempt 的公共行为。

它通常负责：

- 选择 CLI backend 还是 embedded Pi backend
- 维护 transcript / visible output 聚合
- 统一 attempt 结束态和错误态
- 让不同后端共享同一套上层 session 语义

如果说 `agent-command.ts` 是“总入口”，那 `attempt-execution.ts` 就是“执行派单器”。

### 4.3 `src/agents/command/run-context.ts`

这个文件的重要性在于它定义了执行 attempt 共享的上下文。很多看似分散的参数，例如 session、工作区、输出缓冲、transcript sink，本质上都通过 run context 被统一传递。

阅读时要特别注意：

- 哪些字段是在入口阶段就固定的
- 哪些字段允许执行中更新
- 哪些对象承担跨模块共享状态

这能帮助你判断整个 agents 子系统是“显式依赖传递”还是“隐式全局状态”主导。这里整体上更偏前者。

## 5. 执行后端层

## 5.1 `src/agents/pi-embedded-runner/`

这是 `src/agents` 的复杂度中心。很多人第一次看会误以为 agent 执行主要在 `agent-command.ts`，但真正的 runtime 行为其实大量收敛在这里。

其中最关键的入口是：

- `src/agents/pi-embedded-runner/run.ts`

它承担的职责非常重：

- 解析工作区与 fallback workspace
- 确保 runtime plugins 已加载
- 解析模型候选和 auth profile 顺序
- 执行 failover、retry、compaction
- 处理 lane / queue / context engine
- 维护 embedded runtime 的工具、上下文和输出流

这个目录的设计表明，OpenClaw 的 agent runtime 并不是“每次请求拼 prompt 然后发给模型”这么简单，而是已经具备：

- 多轮执行状态
- runtime 能力装配
- 工具调用环境
- 上下文压缩与裁剪
- 模型与认证故障转移

如果你只想抓住 `src/agents` 的核心复杂度，这一层必须重点读。

### 5.2 `src/agents/cli-runner/`

与 embedded runtime 相比，CLI runner 更像“外部执行通道”。

其作用通常包括：

- 准备 CLI 执行环境
- 构造执行参数
- 启动子进程或 CLI backend
- 接收 stdout / stderr / 结构化事件
- 处理可靠性、watchdog、session 持续化

代表文件包括：

- `src/agents/cli-runner.ts`
- `src/agents/cli-runner/prepare.ts`
- `src/agents/cli-runner/execute.ts`
- `src/agents/cli-runner/reliability.ts`

可以把它理解成：embedded runner 是“内嵌执行器”，CLI runner 是“外部执行适配器”。

## 6. 支撑能力层

### 6.1 `src/agents/model-fallback.ts`

这个文件很关键，因为它把模型 failover 从业务流程里抽离成独立策略层。

它主要做：

- 收集模型候选
- 组织重试顺序
- 统一失败摘要
- 在多 provider / 多模型场景下维持可解释的执行路径

这样做的好处是：

- 入口层不用硬编码回退逻辑
- 具体执行器不用重复写 failover 代码
- 日志和错误摘要更容易统一

### 6.2 `src/agents/auth-profiles/`

这是非常值得重视的子系统。它不是简单的 credentials store，而是一套“认证运行时调度层”。

它管理的内容包括：

- profile 持久化和读取
- 使用顺序与 last-good 记忆
- cooldown / failure 标记
- OAuth 刷新与 fallback
- 外部 CLI 凭证同步
- session 级 override

代表文件：

- `src/agents/auth-profiles/order.ts`
- `src/agents/auth-profiles/oauth.ts`
- `src/agents/auth-profiles/external-cli-sync.ts`
- `src/agents/auth-profiles/session-override.ts`
- `src/agents/auth-profiles/store.ts`

这层的存在说明 OpenClaw 已经把“模型执行失败是否因为认证状态异常”当成一等问题处理，而不是让每个 provider 自己零散兜底。

### 6.3 `src/agents/skills/`

这是 workspace skill 的装配层。最值得先读的是：

- `src/agents/skills.ts`
- `src/agents/skills/workspace.ts`

其中 `workspace.ts` 是关键文件，它负责：

- 从多个 skill 根目录加载 skill
- 做路径安全和 workspace containment 检查
- 结合配置做启用/过滤
- 为 prompt 构建紧凑的 skills snapshot

这层非常重要，因为它决定 agent 在当前仓库、当前工作目录下“知道什么”和“该遵守什么”。

也就是说，skills 在这里不是抽象文档，而是运行期 prompt 组成的一部分。

### 6.4 `src/agents/sandbox/`

`src/agents/sandbox/backend.ts` 显示 sandbox 不是写死实现，而是可插拔 backend。

当前设计重点在：

- 抽象 sandbox backend 接口
- 注册 backend 实现
- 把具体容器/远程环境差异隔离在 backend 层

已知 backend 包括：

- `docker`
- `ssh`

这说明 agent 执行环境并不默认等同于本机 shell，而是支持“在哪儿执行”这件事本身可配置。

### 6.5 `src/agents/tools/`

`tools/` 是 agent 能力面向模型暴露的执行面。它负责把“工具能力”转成 agent 可调用的结构化接口。

虽然这次深读重点不在工具逐个解构，但理解它的定位很重要：

- model 输出 tool call
- runtime 负责把调用路由到具体实现
- 工具结果再回流到 transcript / context

因此它是 `pi-embedded-runner` 之外最容易扩张复杂度的区域。

## 7. 设计特征

读完关键文件后，可以总结出 `src/agents` 的几个设计特征。

### 7.1 不是单体，而是“入口编排 + 后端执行 + 支撑运行时”

入口文件不重，复杂度被刻意拆到不同层：

- 入口解决“这次怎么跑”
- 后端解决“实际怎么执行”
- 支撑层解决“用什么能力执行”

### 7.2 把故障和退化路径当成主流程设计

从 `model-fallback.ts`、`auth-profiles/*`、`cli-runner/reliability.ts` 可以看出，这套代码不是假设“理想情况下总会成功”，而是把失败、降级、认证异常、模型切换当成一等场景。

### 7.3 明显偏向显式上下文传递

大量运行参数不是通过隐藏全局读写，而是通过 run context、attempt context、resolved config 等对象向下传递。这样虽然参数多，但更利于定位执行链路。

### 7.4 embedded runtime 是能力中心

如果说 CLI runner 提供兼容性和外部后端适配，那么 embedded runtime 则承载了：

- tool 生态
- context engine
- compaction
- lane / queue
- model/auth failover

这意味着后续新增 agent 能力时，很多改动最终都会收敛到 `pi-embedded-runner/`。

## 8. 学习路径建议

如果你的目标是“快速理解这套 agent 架构并能上手改代码”，推荐按下面顺序读：

1. `src/agents/agent-command.ts`
   - 先理解入口到底准备了什么。
2. `src/agents/command/attempt-execution.ts`
   - 看执行是如何分派到不同后端的。
3. `src/agents/command/run-context.ts`
   - 建立执行上下文模型。
4. `src/agents/model-fallback.ts`
   - 理解模型候选与失败回退。
5. `src/agents/skills/workspace.ts`
   - 理解 workspace skill 如何影响 agent prompt。
6. `src/agents/auth-profiles/order.ts`、`src/agents/auth-profiles/oauth.ts`
   - 理解认证状态如何影响执行稳定性。
7. `src/agents/pi-embedded-runner/run.ts`
   - 最后进入复杂度中心。
8. 再按需读 `src/agents/cli-runner/*`、`src/agents/sandbox/*`、`src/agents/tools/*`

这个顺序的好处是：先建立“大框架”，再进入真正复杂的 runtime 内核，否则一开始直接看 embedded runner 很容易迷路。

## 9. 最值得关注的风险点

如果后续你要在这个目录里开发功能，最值得警惕的不是单个函数，而是几个横切问题：

- session / transcript 生命周期是否被破坏
- failover 与 auth profile 顺序是否仍然可解释
- skills snapshot 是否引入越权或路径污染
- sandbox backend 是否和本机执行路径混淆
- CLI backend 与 embedded backend 是否保持语义一致

`src/agents` 的难点不在某个算法，而在这些横向约束很多，改一个点常常会影响整个执行链。

## 10. 一句话总结

`src/agents` 可以理解为 OpenClaw 的 agent 执行中枢：顶层做请求收束与执行编排，中层做 CLI / embedded 后端分发，底层由 auth、skills、sandbox、tools 和 runtime 机制支撑。其中真正的复杂度核心是 `pi-embedded-runner/`，而不是表面上的入口文件。
