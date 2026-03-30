# OpenClaw `src/gateway` 深读报告

## 1. 模块定位

`src/gateway` 是 OpenClaw 的运行时控制平面。它的职责不是单纯“开一个 WebSocket 服务”，而是把下面这些本来分散的能力装配成一个统一服务：

- Gateway 协议与连接管理
- 插件启动与运行时注册
- channel 管理与状态广播
- session / chat / agent 入口
- 节点、设备、日志、配置、健康检查等 RPC 方法
- sidecar 和后台维护任务

如果 `src/agents` 是执行中枢，那么 `src/gateway` 就是系统调度中枢。它把 operator、node、channel、plugin、session、agent 都接到同一个控制面上。

## 2. 目录结构总览

`src/gateway` 最核心的三层目录是：

- `protocol/`
  - Gateway 的线协议与 schema 合同层。
- `server-methods/`
  - 具体 RPC 方法实现层。
- `server/`
  - 连接、HTTP、WebSocket 等服务细节支撑层。

此外，根目录下还有一大批“装配与运行时协作文件”，比如：

- `server.impl.ts`
- `server-plugin-bootstrap.ts`
- `server-runtime-state.ts`
- `server-startup.ts`
- `server-channels.ts`
- `server-chat.ts`
- `server-ws-runtime.ts`
- `server-methods.ts`

理解 `src/gateway` 的最好方式，不是把它看成一个文件夹，而是看成四层：

1. 协议合同层
   - `protocol/*`
2. 请求分发层
   - `server-methods.ts`
   - `server-methods/*`
3. 运行时装配层
   - `server.impl.ts`
   - `server-runtime-state.ts`
   - `server-plugin-bootstrap.ts`
   - `server-startup.ts`
4. 连接与后台支撑层
   - `server/ws-connection.ts`
   - `server-http.ts`
   - `server-discovery.ts`
   - `server-maintenance.ts`

## 3. 启动总流程

Gateway 启动的主链路可以概括为：

1. 进入 `src/gateway/server.impl.ts`
2. 读取配置并初始化基础运行参数
3. 通过 `loadGatewayStartupPlugins(...)` 装配插件侧能力
4. 创建 channel manager
5. 构造 runtime state
6. 绑定 WebSocket / HTTP 处理器
7. 启动 discovery、maintenance、tailscale 暴露、sidecars、config reload 等后台机制

因此 `server.impl.ts` 的角色不是“业务处理器”，而是 Gateway 的总装配根。

## 4. 关键文件解读

### 4.1 `src/gateway/server.impl.ts`

这是 `src/gateway` 最重要的入口文件。它负责把 Gateway 从一组零散模块装成一个真正运行中的服务。

它承担的职责包括：

- 加载配置快照
- 初始化插件启动流程
- 创建 channel manager
- 创建 runtime state
- 附加 WS 连接处理
- 启动 discovery / maintenance / sidecars / reload 机制

读这个文件时，建议重点看“先后顺序”，因为这里体现了系统依赖关系：

- 哪些对象必须先于 server 创建
- 哪些能力依赖 plugin bootstrap 之后才能使用
- 哪些后台任务要在核心 listener 就绪后才能启动

### 4.2 `src/gateway/server-plugin-bootstrap.ts`

这是插件和 Gateway 之间的桥接层。它的作用不是简单“加载插件”，而是让插件运行时真正加入 Gateway 服务图谱。

它大致负责：

- 应用 plugin auto-enable 策略
- 安装 gateway plugin runtime 环境
- 加载 gateway plugins
- 预热 configured binding registry

这个文件的重要意义是：Gateway 不是只服务 core 内置能力，它必须把插件暴露出的 channel、provider、service、HTTP surface 一并接进来。

### 4.3 `src/gateway/server-runtime-state.ts`

这个文件构造的是 Gateway 的“活体状态容器”。

它会把很多运行时对象固定下来，例如：

- 当前活跃 plugin HTTP / channel registries
- canvas host
- HTTP server
- WebSocket server
- broadcaster
- chat run state
- dedupe map
- tool event recipient registry

理解它的方式可以类比“应用容器”：

- `server.impl.ts` 负责组装
- `server-runtime-state.ts` 负责承载长期运行状态

### 4.4 `src/gateway/server-ws-runtime.ts`

这是装配层和 WebSocket 连接层之间的薄适配器。它本身不承载太多业务，但很关键，因为它把 runtime state 注入到具体连接处理逻辑里。

这个文件说明 `src/gateway` 在结构上刻意把：

- “运行时状态”
- “单连接生命周期”

拆成了两层，而没有把所有逻辑塞进一个超大连接处理器里。

### 4.5 `src/gateway/server/ws-connection.ts`

真正的 WebSocket 连接生命周期在这里。

它负责：

- 握手
- preauth budget
- 连接认证上下文
- presence / broadcast 协同
- 单连接状态跟踪与日志

从职责上看，这里处理的是“连接问题”，而不是“业务方法问题”。这种分层很重要，因为它把“传输层连接控制”和“Gateway 方法调用”分开了。

## 5. 方法分发层

### 5.1 `src/gateway/server-methods.ts`

这是 RPC 方法总分发器。你可以把它看成 Gateway 的方法路由中枢。

它的核心职责包括：

- 聚合各类 handler 形成 `coreGatewayHandlers`
- 对每个请求执行 role / scope 授权
- 在 plugin runtime gateway request scope 中包裹请求执行

这一层的价值在于把“方法注册”和“方法执行约束”放在一起统一处理，而不是让每个方法文件自行各管一套。

### 5.2 `src/gateway/server-methods/`

这个目录是真正的 RPC 行为层。文件数量很多，说明 Gateway 已经覆盖比较广的运行面。

重点值得读的有：

- `src/gateway/server-methods/agent.ts`
  - agent 执行入口，处理 run id 去重、session reset、参数校验，并委托到 `agentCommandFromIngress(...)`。
- `src/gateway/server-methods/sessions.ts`
  - session 的创建、列出、更新、删除、reset、preview、send、subscribe / unsubscribe。
- `src/gateway/server-methods/chat.ts`
  - chat 相关 Gateway surface。
- `src/gateway/server-methods/channels.ts`
  - channel 状态与管理方法。
- `src/gateway/server-methods/nodes.ts`
  - node 相关调用与能力协同。
- `src/gateway/server-methods/config.ts`
  - 配置读写与相关流程。
- `src/gateway/server-methods/health.ts`
  - 健康状态暴露。

这层的设计有两个明显特征：

- 方法多，但每类能力都有相对稳定的文件归属
- 统一通过 `server-methods.ts` 挂到 Gateway，而不是让连接层直接 import 零散业务函数

## 6. 协议合同层

### 6.1 `src/gateway/protocol/index.ts`

这是 Gateway 协议的门面层，负责导出：

- validators
- schemas
- protocol version
- request / response / event frame 类型

这层的职责是“统一线协议表面”，避免调用方直接依赖分散 schema 文件。

### 6.2 `src/gateway/protocol/schema.ts`

这是 schema 聚合入口。它把各主题 schema 汇总成 Gateway 协议可消费的统一定义。

### 6.3 `src/gateway/protocol/schema/agent.ts`

这个文件对理解 Gateway 如何暴露 agent 能力很重要。它定义的不是内部实现，而是协议层 contract，例如：

- `agent`
- `send`
- `poll`
- `agent.wait`

从这里可以看出 Gateway 不是只有“请求-响应”模式，还明确支持 agent 运行期轮询和等待语义。

### 6.4 `src/gateway/protocol/AGENTS.md`

这里的边界规则非常值得记住：

- protocol 变更是 wire contract 变更
- 默认优先 additive evolution
- 不兼容修改需要显式版本化和后续联动

这意味着 `protocol/*` 不是普通内部代码目录，而是系统对外合同的一部分。

## 7. 启动后的后台机制

### 7.1 `src/gateway/server-startup.ts`

这个文件负责在核心服务起稳后拉起各种 sidecar 和后台子系统，例如：

- stale lock cleanup
- Gmail watcher
- internal hooks
- channel startup
- plugin services
- ACP reconciliation
- memory backend startup

换句话说，Gateway 不是“监听端口以后就结束”，它还要持续协调多个后台运行面。

### 7.2 `src/gateway/server-channels.ts`

这一层负责 Gateway 和 channels 运行时之间的衔接，包括 channel manager 的工作面、状态同步以及相关启动逻辑。

### 7.3 `src/gateway/server-chat.ts`

这一层则负责把 Gateway 侧的 chat / run 状态组织起来，让 agent 执行、消息状态、事件广播之间能协同工作。

## 8. 一个典型请求是如何流动的

以 Gateway 发起一次 agent 执行为例，链路大致是：

1. 客户端通过 WS/HTTP 进入 Gateway
2. 连接由 `src/gateway/server/ws-connection.ts` 完成握手和认证上下文建立
3. 请求进入 `src/gateway/server-methods.ts`
4. 方法路由到 `src/gateway/server-methods/agent.ts`
5. `agent.ts` 做参数校验、session reset 处理、run id 去重
6. 委托到 agents 子系统，例如 `agentCommandFromIngress(...)`

## 9. 与 `learn/gateway-design` 的映射

为了把这些概念变成可动手的学习工程，`learn/gateway-design` 现在刻意映射了 `src/gateway` 的几条主线，但做了范围收缩：

- `src/gateway/protocol/*`
  - 对应 `learn/gateway-design/src/protocol/index.ts`
  - 学习版保留 request / response / event 合同、`agent.wait`、`sessions.messages.subscribe` 等关键 surface，不引入 Ajv 和大规模 schema 集合。
- `src/gateway/server-runtime-state.ts`
  - 对应 `learn/gateway-design/src/server-runtime-state.ts`
  - 学习版保留 broadcaster、dedupe、chat run 状态容器，让你先理解“Gateway 为什么必须持有活体状态”。
- `src/gateway/server-chat.ts`
  - 对应 `learn/gateway-design/src/server-chat.ts`
  - 学习版聚焦 active run、terminal run、message subscribers 三件事。
- `src/gateway/server-methods.ts` + `src/gateway/server-methods/*`
  - 对应 `learn/gateway-design/src/server-methods.ts` + `learn/gateway-design/src/methods/*`
  - 学习版保留按 domain 拆 handler 的结构，并增加 `agent.wait`、`sessions.messages.subscribe` 来体现长任务和消息面订阅。
- `src/gateway/server-ws-runtime.ts`
  - 对应 `learn/gateway-design/src/server-ws-runtime.ts`
  - 学习版把 ws handler 装配从 `server.ts` 拆出，让 `server.ts` 更像真正的 assembly root。
- `src/gateway/server-plugin-bootstrap.ts`
  - 对应 `learn/gateway-design/src/server-plugin-bootstrap.ts`
  - 学习版只注册 `MockChannel`，用来讲清“插件启动插在什么位置”。
- `src/gateway/session-utils.ts` 一类的 session / transcript 读写面
  - 对应 `learn/gateway-design/src/session-store.ts` 和 `learn/gateway-design/src/transcript-store.ts`
  - 学习版把“轻量 metadata”和“完整 transcript”显式分成两个模块。

学习版最重要的设计选择是：Gateway 不再自己实现一个内联 `agent-runner`，而是通过 public API 调 `learn/agent-design`。这一步正好把 OpenClaw 里 `src/gateway` 和 `src/agents` 的边界具象化了。
7. 运行中的事件通过 broadcaster / tool event recipient / session 更新机制继续向外传播
8. 客户端可通过 `poll`、`agent.wait`、session 订阅等方式继续观察执行结果

这个链路能反映出 `src/gateway` 的本质：它是控制平面，不是模型执行器本身。真正执行仍由 `src/agents` 承担，但 Gateway 负责把这件事以协议化、可订阅、可管理的方式暴露出来。

## 9. 设计特征

### 9.1 明确分层：协议、方法、装配、连接

`src/gateway` 的可维护性主要来自分层清楚：

- `protocol/*` 定义合同
- `server-methods/*` 定义行为
- `server.impl.ts` 定义装配
- `server/ws-connection.ts` 定义连接生命周期

### 9.2 Gateway 是控制面，不是单纯 API server

很多文件名看起来像普通后端，但实际上这里处理的是：

- 节点能力
- agent 生命周期
- session 变更
- channel 状态
- 广播与 presence
- sidecar 协调

它更像一个本地控制平面，而不只是“把 HTTP handler 挂上去”。

### 9.3 插件是一级公民

从 `server-plugin-bootstrap.ts` 和 runtime state 设计能看出，Gateway 并不是把插件当附属功能，而是把插件 runtime 纳入了核心启动流程。

### 9.4 协议稳定性要求高

`protocol/*` 的边界约束说明，这一层任何修改都必须考虑客户端、节点、控制 UI、文档和代码生成的一致性。

## 10. 学习路径建议

如果你要系统掌握 `src/gateway`，推荐按这个顺序读：

1. `src/gateway/server.impl.ts`
   - 先理解 Gateway 是如何装起来的。
2. `src/gateway/server-plugin-bootstrap.ts`
   - 看插件如何并入 Gateway。
3. `src/gateway/server-runtime-state.ts`
   - 建立运行时状态模型。
4. `src/gateway/server-methods.ts`
   - 理解请求如何路由到具体方法。
5. `src/gateway/server-methods/agent.ts`
   - 看 agent 入口如何接到 agents 子系统。
6. `src/gateway/server-methods/sessions.ts`
   - 看 session 如何成为 Gateway 的核心资源。
7. `src/gateway/server/ws-connection.ts`
   - 理解连接生命周期和认证上下文。
8. `src/gateway/protocol/index.ts`、`src/gateway/protocol/schema/agent.ts`
   - 最后回到协议合同层，建立外部视角。

这个顺序比直接从 `protocol/` 开始更好，因为你先知道系统是怎么运行的，再回头看 wire contract，会更容易理解每个 schema 为什么存在。

## 11. 开发时最容易踩的点

后续如果你改 `src/gateway`，最容易出问题的是以下几类边界：

- 修改 protocol schema 但没有同步客户端 / 文档 / 版本语义
- 绕过 `server-methods.ts` 直接在连接层塞业务逻辑
- 直接写 transcript，而不是通过 session 管理约束路径
- 插件启动顺序和 runtime registry 生命周期不一致
- 连接认证、role / scope 授权和方法执行语义脱节

尤其要注意 `src/gateway/server-methods/AGENTS.md` 的约束：session transcript 写入必须走 `SessionManager.appendMessage(...)` 一类受控路径，而不是原始 JSONL 操作。

## 12. 一句话总结

`src/gateway` 是 OpenClaw 的运行时控制平面：`server.impl.ts` 负责系统装配，`server-methods.ts` 负责 RPC 路由，`protocol/*` 负责线协议合同，`server/*` 负责连接与后台运行细节。它真正连接的是“插件、channel、session、agent、node”这五类核心运行对象。
