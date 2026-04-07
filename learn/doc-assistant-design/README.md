# Learn Doc Assistant

`learn/doc-assistant-design` 是一个用于学习“本地 Markdown 文档问答”控制面的示例包。它借鉴了 `learn/gateway-design` 的核心心智模型，但把业务目标换成了技术文档助手：

- 通过 WebSocket/RPC 暴露问答接口
- 给调用方分配临时 user id
- 把 user id 绑定到稳定 session
- 按需重建本地 Markdown 索引并检索
- 基于检索结果生成 grounded answer
- 可选把检索上下文交给 `learn/agent-design`，演示 retrieval + agent 的组合

## 当前结构

```text
src/
  cli.ts                  # 本地命令行 demo，直接对 docs 目录提问
  protocol/
    index.ts              # Wire contract: request / response / event / validators
  doc-index.ts            # 扫描 docs/，按 heading / paragraph 切 chunk，写出 JSON index
  doc-search.ts           # 词法检索、平台/产品/section rerank、snippet / citation 生成
  doc-answer.ts           # extractive / agent 两种回答模式
  openai-compatible.ts    # OpenAI-compatible Chat Completions 调用
  smoke.ts                # 单轮问答 helper，供 CLI 和外部 smoke 使用
  user-store.ts           # temp user 持久化
  session-store.ts        # session-memory-design 的适配层
  transcript-store.ts     # transcript 读写适配层
  server-runtime-state.ts # broadcaster / dedupe / active runs
  methods/
    docs.ts               # docs.* RPC methods
  server.ts               # 总装配入口
```

## 架构设计

这个 learning 包可以按 6 层来看。它不是“把问题丢给检索再拼答案”的单函数实现，而是一个小型控制面：

```text
transport / entry
  -> rpc application surface
  -> run orchestration
  -> retrieval + reasoning subsystems
  -> state / memory / persistence
```

### 1. 传输与入口层

- `src/index.ts`
  - 进程入口，读取 `.env`，调用 `createDocAssistantServer()`，打印已注册方法
- `src/server.ts`
  - composition root，总装配点
  - 负责组装 `httpServer`、`router`、`runtime state`、WebSocket handlers、HTTP API、UI
- `src/http-api.ts`
  - HTTP adapter，把 REST 路径映射到同一套 `docs.*` RPC 方法
  - 例如 `POST /api/doc-assistant/runs` 最终仍然分发到 `docs.ask`
- `src/server-ws-runtime.ts`
  - WebSocket adapter，负责把连接接入 `handleConnection()`
- `src/http-ui.ts`
  - 静态页面 adapter，服务 demo UI

这一层采用的是 adapter 模式。HTTP、WebSocket、UI 都不直接实现业务，只负责把外部请求适配进统一的 method surface。

### 2. 协议与方法层

- `src/protocol/index.ts`
  - 定义 wire contract 和领域 DTO
  - 关键接口包括：
    - `DocAssistantRequest` / `DocAssistantResponse` / `DocAssistantEvent`
    - `ConnectedClient`
    - `DocsAskParams` / `DocsRunStatusParams` / `DocsRunWaitParams`
    - `DocsTerminalResult`
    - `AnswerMemoryEntry`
  - 同时提供参数校验函数，例如 `validateDocsAskParams()`、`validateDocsRunWaitParams()`
- `src/method-router.ts`
  - 一个很轻量的 command bus / RPC router
  - 暴露 `register()`、`dispatch()`、`listMethods()`
  - 内建 scope 检查和统一错误包装
- `src/server-methods.ts`
  - method registry，把方法名注册到具体 handler
- `src/methods/docs.ts`
  - application service 层
  - 这里定义了系统对外真正可调用的接口：
    - `docs.user.create`
    - `docs.ask`
    - `docs.run.status`
    - `docs.run.wait`
    - `docs.session.transcript.get`
    - `docs.history.list`
    - `docs.search.preview`
    - `docs.admin.memory.list`
    - `docs.admin.memory.get`
    - `docs.admin.memory.approve`
    - `docs.admin.memory.reject`
    - `docs.admin.memory.update`
    - `docs.methods`
    - `docs.status`

这一层采用 manifest-less method registration 的路由模式。调用方不需要知道底层是 HTTP 还是 WebSocket，只需要知道方法名和参数结构。

### 3. 运行时与控制面层

- `src/server-runtime-state.ts`
  - 文档助手的 in-memory control plane
  - 核心对象有：
    - `EventBroadcaster`：向连接广播 `docs.retrieval`、`docs.delta`、`docs.completed`
    - `DocRunState`：维护 `activeRuns` / `terminalRuns`
    - `dedupe`：缓存 idempotency 结果，避免重复发起同一个 run
    - `config`：保存 `docsRoot`、`defaultMode`、`adminToken`、默认模型配置
- `docs.ask` 的生命周期
  - 先立即返回 `DocsAcceptedResult`
  - 后台异步执行 `executeDocQuestion()`
  - 执行过程中可推送 retrieval / delta 事件
  - 结束后进入 terminal result，并支持 `docs.run.wait`

这里采用的是 run-state-machine + event-bus 设计。也就是把“请求已接收”“运行中”“终态结果”“实时事件”拆开，而不是做成同步阻塞 RPC。

### 4. 执行编排层

- `src/question-execution.ts`
  - 这是单轮问答的 orchestrator，也是最核心的应用编排器
  - 输入是 `runId + question + mode + docsRoot + callbacks`
  - 输出是：
    - `route: "greeting" | "memory" | "search"`
    - `hits`
    - `answer`
  - 内部编排顺序大致是：
    1. `buildQuestionState()` 解析问题状态
    2. 检测是否是 clarification follow-up，并尝试重写问题
    3. 命中 greeting route / answer memory route / retrieval route
    4. 构造 staged retrieval plan
    5. 执行检索并合并 hits
    6. 运行 `answerability` 和 `clarification` policy
    7. 调用 `buildDocAnswer()` 生成 grounded answer
    8. 用 `validateAnswer()` 做结果校验和必要降级
    9. 产出 trace、follow-up metadata、terminal answer

这层是典型的 orchestration pipeline。每一步都调用独立子系统，本身尽量不把策略硬编码进传输层或存储层。

### 5. 检索、判定和回答子系统

这一层是文档助手的“推理内核”，但仍然被拆成多个小模块，而不是堆在一个文件里。

- `src/doc-index.ts`
  - 文档索引层
  - 主要接口：
    - `buildDocIndex()`
    - `loadCachedDocIndex()`
    - `isDocIndexFresh()`
    - `rebuildDocIndexIfNeeded()`
  - 负责扫描 Markdown、切 chunk、写入 `doc-index.json` 和 metadata
- `src/doc-search.ts`
  - 检索层
  - 主要接口：
    - `loadDocChunks()`
    - `searchDocsForBucket()`
    - `searchDocsForPurpose()`
    - `searchDocs()`
    - `toCitation()`
  - 负责 lexical scoring、平台/产品/channel/API layer 对齐、doc shape/rerank、citation 生成
- `src/question-state.ts`
  - query understanding 层
  - 把原始问题归一成 `QuestionState`
  - 包括 language、intent、platform、product、apiLayer、channelKind、anchors、ambiguity
- `src/retrieval-plan.ts`
  - retrieval planner
  - 把一个问题拆成 primary queries + expansion queries
- `src/answerability.ts`
  - answerability gate
  - 判断当前证据是否足以支撑回答
- `src/clarification-policy.ts`
  - clarification gate
  - 决定是否要继续追问 platform / product / api layer / task focus
- `src/follow-up-context.ts`
  - follow-up continuation 层
  - 保存上一次 clarification 的上下文，支持“iOS 呢”“那 Web 呢”这类短跟进问题
- `src/evidence-pack.ts`
  - evidence normalization 层
  - 把 hits 压缩成可供回答器和 validator 消费的证据包
- `src/doc-answer.ts`
  - answer synthesis 层
  - 主要接口：
    - `buildDocAnswer()`
    - `renderClarificationAnswer()`
    - `buildInsufficientEvidenceAnswer()`
    - `buildTerminalResult()`
  - 支持 extractive answer，也支持 agent / OpenAI-compatible 重写
- `src/answer-render.ts` + `src/answer-plan.ts`
  - prompt/render 层
  - 负责把证据包和回答计划变成最终输出模板
- `src/answer-validator.ts`
  - post-generation validator
  - 检查 citation topic mismatch、cross-platform、missing clarification 等问题

这里采用的是 pipeline + policy object + strategy 模式的组合：

- pipeline：检索、判定、生成、校验顺序明确
- policy object：`answerability`、`clarification`、`validator` 都是独立决策器
- strategy：`buildDocAnswer()` 会根据 mode 和 provider 走 extractive、learning agent、OpenAI-compatible 等不同回答策略

### 6. 状态、记忆和持久化层

- `src/user-store.ts`
  - temp user 仓储，核心接口是 `createTempDocUser()`、`getTempDocUser()`
- `src/session-store.ts`
  - session 适配层，复用 `learn/session-memory-design`
  - 核心接口是 `getOrCreateSession()`、`updateSessionEntry()`、`listSessions()`
- `src/transcript-store.ts`
  - transcript 适配层，负责追加用户消息和最终回答
- `src/question-history.ts`
  - 问答历史层，保存结构化 history entry，便于 QA 和后台查看
- `src/answer-memory.ts`
  - answer memory 仓储
  - 负责标准答案缓存、review queue、审批流
  - 核心接口包括：
    - `findAnswerMemoryMatch()`
    - `enqueueGeneratedAnswerMemory()`
    - `approveAnswerMemoryEntry()`
    - `rejectAnswerMemoryEntry()`
    - `updateAnswerMemoryEntry()`
- `src/retrieval-memory.ts`
  - retrieval memory 仓储
  - 用历史经验影响后续检索路径偏好
- `src/persistence.ts`
  - 最底层文件持久化 helper
  - 提供 `writeJsonAtomic()`、`appendJsonlAtomic()`、`readJsonSafe()` 等原语

这里采用 repository + adapter 模式。上层看到的是 user/session/transcript/memory 这些领域仓储，而不是直接散落的 JSON/JSONL 文件。

### 一次 `docs.ask` 的主链路

```text
HTTP POST /runs or WS docs.ask
  -> protocol validator
  -> MethodRouter.dispatch()
  -> docsAskHandler()
  -> register run + return accepted
  -> executeDocQuestion()
     -> question-state / follow-up rewrite
     -> memory hit or retrieval
     -> answerability / clarification gate
     -> buildDocAnswer()
     -> validateAnswer()
  -> append transcript / update session / append history
  -> enqueue answer memory if cacheable
  -> broadcast docs.completed
```

### 这个包的设计模式总结

- Composition Root：`src/server.ts` 统一装配所有 runtime 依赖
- Adapter / Ports-and-Adapters：HTTP、WebSocket、UI、OpenAI-compatible、session-memory 都是适配器
- Command Bus / RPC Router：`MethodRouter` 按 method name 分发 handler
- Orchestrator：`executeDocQuestion()` 统一协调多个子系统
- Pipeline：问题理解 -> 检索 -> 证据判定 -> 生成 -> 校验 -> 落盘
- Strategy：不同回答 surface 使用不同生成策略
- Repository：user/session/transcript/history/memory 都通过仓储对象访问
- Event-driven Run Model：`accepted`、`delta`、`completed`、`wait` 把长任务拆成多种语义

### 为什么这样分层

- 传输层和业务层分开，CLI、HTTP、WebSocket 可以复用同一套方法
- 方法层和执行层分开，`docs.ask` 只负责控制面，不负责具体检索细节
- 执行层和策略层分开，便于单测 `answerability`、`clarification`、`retrieval-plan`
- 回答层和记忆层分开，标准答案审批流不会污染即时生成链路
- session/transcript/history 分开，便于分别处理会话归属、聊天记录和 QA 分析

## 学习重点

### 1. 文档助手也是控制平面问题

`docs.ask` 不直接把“搜索 + 回答 + 会话状态”写死在连接层里，而是拆成：

- WebSocket 连接生命周期
- method router
- session / transcript 适配层
- doc indexing / retrieval
- answer execution
- run tracking / wait / terminal events

### 2. 检索层和回答层要分开

- `doc-index.ts`
  - 负责把 Markdown 文档变成可检索 chunk
- `doc-search.ts`
  - 负责 lexical scoring、平台/产品/页面主题/section intent rerank 和 citations
- `doc-answer.ts`
  - 负责把检索结果变成最终 answer

这样你能更清楚地看见 RAG 里的“检索”和“生成”并不是一层逻辑。

### 3. agent 模式不应该污染真实用户 transcript

`agent` 模式会调用 `learn/agent-design` 以复用 streaming / terminal run 语义，但它会把 learning agent 的 scratch run 隔离到单独 data dir。真实用户 transcript 只记录：

- 用户原始问题
- 文档助手的最终回答

这样更接近真实系统里“控制面 prompt”和“用户会话记录”分层的设计。

## 推荐阅读顺序

1. `src/protocol/index.ts`
2. `src/server-runtime-state.ts`
3. `src/user-store.ts`
4. `src/session-store.ts`
5. `src/doc-index.ts`
6. `src/doc-search.ts`
7. `src/doc-answer.ts`
8. `src/methods/docs.ts`
9. `src/server.ts`

## 运行和测试

```bash
cd learn/doc-assistant-design
npm install
node --import ./node_modules/tsx/dist/loader.mjs src/index.ts
npm test
```

## 排查指南

如果你要复盘某一轮问答为什么答错，先看这份文档：

- `learn/doc-assistant-design/QA_DEBUG_GUIDE.md`

## 部署文档

这一节记录一套可手动执行的部署流程，适合当前这个 learning 包在内网测试机上运行。

### 目标

- 把 `learn/doc-assistant-design` 部署到远端 Linux 机器
- 通过 `node + tsx` 直接运行 `src/server.ts`
- 用 `.env` 指定文档根目录、模型地址、API Key 和模型名
- 通过 `/health` 和 `/api/doc-assistant/status` 验证服务是否成功启动
- 通过版本号确认当前线上是否已经是你想要的构建

### 版本约定

当前代码内置版本：

- marketing version: `v0.1`
- package version: `0.1.0`

启动成功后，可以从这两个接口看到版本：

```bash
curl http://127.0.0.1:8790/health
curl http://127.0.0.1:8790/api/doc-assistant/status
```

### 部署前提

远端机器需要具备：

- Node.js
- 运行 `npm install` 后生成的本地 `node_modules`
- 文档目录
- 能访问你的 OpenAI-compatible 网关

建议远端目录结构如下：

```text
/home/rc/doc-assistant-deploy/
  run-doc-assistant.sh
  doc-assistant.log
  learn/
    doc-assistant-design/
  rc-new-docs/
```

这里的关键点是：

- `learn/doc-assistant-design` 是实际运行目录
- `learn/doc-assistant-design/node_modules/tsx/dist/loader.mjs` 是本地 TS loader
- `rc-new-docs/` 是文档根目录

### 第 1 步：本地确认代码可运行

```bash
cd /path/to/openclaw
npm run typecheck
npm test
```

如果这两步不过，不要先部署。

### 第 2 步：准备远端 `.env`

远端 `learn/doc-assistant-design/.env` 可以这样写：

```env
DOC_ASSISTANT_DOCS_ROOT=/home/rc/doc-assistant-deploy/rc-new-docs
DOC_ASSISTANT_BASE_URL=https://your-openai-compatible-endpoint.example.com/v1
DOC_ASSISTANT_API_KEY=sk-...
DOC_ASSISTANT_MODEL=gpt-5.4
```

注意：

- `DOC_ASSISTANT_DOCS_ROOT` 必须写远端机器自己的路径
- 不要把你本机的路径同步到远端
- 建议不要把本地 `.env` 直接覆盖远端 `.env`

### 第 3 步：准备远端启动脚本

远端 `/home/rc/doc-assistant-deploy/run-doc-assistant.sh` 可以用下面这个版本：

```bash
#!/usr/bin/env bash
set -euo pipefail

export PATH="$HOME/.local/node/bin:$PATH"
cd "$HOME/doc-assistant-deploy/learn/doc-assistant-design"

node --import ./node_modules/tsx/dist/loader.mjs --input-type=module -e "
import process from 'node:process';
import { createDocAssistantServer } from './src/server.ts';
import { loadDocAssistantDotEnv, resolveDocAssistantDocsRootFromEnv } from './src/env.ts';

loadDocAssistantDotEnv();

const parseAllowedOrigins = (raw) =>
  raw ? raw.split(',').map((origin) => origin.trim()).filter(Boolean) : undefined;

const server = await createDocAssistantServer({
  host: '0.0.0.0',
  port: 8790,
  docsRoot: resolveDocAssistantDocsRootFromEnv(),
  allowedOrigins: parseAllowedOrigins(process.env.DOC_ASSISTANT_CORS_ORIGINS),
});

console.log('Learn Doc Assistant is running.');
console.log('Version:', server.version + ' (' + server.packageVersion + ')');
console.log('WebSocket:', server.url);
console.log('HTTP API:', server.apiBaseUrl);
console.log('UI:', server.uiUrl);

await new Promise(() => {});
"
```

写完之后：

```bash
chmod +x /home/rc/doc-assistant-deploy/run-doc-assistant.sh
```

### 第 4 步：把代码传到远端

推荐方式一：`rsync`

```bash
rsync -a --delete \
  --exclude .mini-doc-assistant-data \
  --exclude .smoke-data \
  --exclude .env \
  /path/to/openclaw/learn/doc-assistant-design/ \
  rc@<server-host>:/home/rc/doc-assistant-deploy/learn/doc-assistant-design/
```

说明：

- `--exclude .mini-doc-assistant-data` 避免把本地运行数据带上去
- `--exclude .smoke-data` 避免带测试数据
- `--exclude .env` 避免覆盖远端配置

如果你没有稳定的 `rsync` 流程，可以用方式二：打包上传。

推荐方式二：`tar + scp`

本地打包：

```bash
tar -czf /tmp/doc-assistant-design.tgz \
  --exclude='doc-assistant-design/.mini-doc-assistant-data' \
  --exclude='doc-assistant-design/.smoke-data' \
  --exclude='doc-assistant-design/.env' \
  -C /path/to/openclaw/learn \
  doc-assistant-design
```

上传：

```bash
scp /tmp/doc-assistant-design.tgz rc@<server-host>:/home/rc/doc-assistant-deploy/doc-assistant-design.tgz
```

远端解压：

```bash
ssh rc@<server-host>
mkdir -p /home/rc/doc-assistant-deploy/learn
tar -xzf /home/rc/doc-assistant-deploy/doc-assistant-design.tgz -C /home/rc/doc-assistant-deploy/learn
```

### 第 5 步：重启服务

在远端执行：

```bash
pids=$(lsof -ti tcp:8790 2>/dev/null || true)
if [ -n "$pids" ]; then
  kill -9 $pids
fi

nohup bash /home/rc/doc-assistant-deploy/run-doc-assistant.sh \
  > /home/rc/doc-assistant-deploy/doc-assistant.log 2>&1 < /dev/null &
```

如果你想一条命令完成：

```bash
pids=$(lsof -ti tcp:8790 2>/dev/null || true); \
if [ -n "$pids" ]; then kill -9 $pids; fi; \
nohup bash /home/rc/doc-assistant-deploy/run-doc-assistant.sh \
  > /home/rc/doc-assistant-deploy/doc-assistant.log 2>&1 < /dev/null &
```

### 第 6 步：验证部署是否成功

先看日志：

```bash
tail -n 20 /home/rc/doc-assistant-deploy/doc-assistant.log
```

正常情况下会看到：

```text
Learn Doc Assistant is running.
Version: v0.1 (0.1.0)
WebSocket: ws://0.0.0.0:8790
HTTP API: http://0.0.0.0:8790/api/doc-assistant
UI: http://0.0.0.0:8790/ui
```

再看健康检查：

```bash
curl http://127.0.0.1:8790/health
curl http://127.0.0.1:8790/api/doc-assistant/status
```

你应该至少确认这几个字段：

- `status`
- `version`
- `packageVersion`
- `docsRoot`

例如：

```json
{
  "status": "ok",
  "version": "v0.1",
  "packageVersion": "0.1.0"
}
```

以及：

```json
{
  "ok": true,
  "result": {
    "status": "running",
    "version": "v0.1",
    "packageVersion": "0.1.0",
    "docsRoot": "/home/rc/doc-assistant-deploy/rc-new-docs"
  }
}
```

### 第 7 步：验证页面是否可访问

如果你只是内网测试，可以直接在远端本机访问：

```bash
curl http://127.0.0.1:8790/ui
```

如果你已经做了反向代理，再从浏览器访问代理后的地址。

### 常见问题

#### 1. 版本对了，但 `docsRoot` 不对

通常是因为你把本地 `.env` 同步到了远端。

修复方式：

```bash
sed -i 's#^DOC_ASSISTANT_DOCS_ROOT=.*#DOC_ASSISTANT_DOCS_ROOT=/home/rc/doc-assistant-deploy/rc-new-docs#' \
  /home/rc/doc-assistant-deploy/learn/doc-assistant-design/.env
```

然后重启服务。

#### 2. `/health` 能打开，但答案不对

这通常不是服务没起来，而是以下问题之一：

- `DOC_ASSISTANT_DOCS_ROOT` 指错了
- 文档目录没同步完整
- 模型网关不可达
- API Key 或 model 配置不对

可以先检查：

```bash
cat /home/rc/doc-assistant-deploy/learn/doc-assistant-design/.env
tail -n 50 /home/rc/doc-assistant-deploy/doc-assistant.log
```

#### 3. 想确认当前到底部署了哪个版本

直接看：

```bash
curl http://127.0.0.1:8790/health
curl http://127.0.0.1:8790/api/doc-assistant/status
tail -n 20 /home/rc/doc-assistant-deploy/doc-assistant.log
```

只要这三个地方都显示 `v0.1`，基本就说明当前跑的是这版。

### 我这次实际使用过的命令类型

这次手工部署里，实际用到的命令就是这些：

```bash
npm run typecheck
npm test
rsync -a --delete ...
tar -czf ...
scp ...
ssh ...
sed -i ...
lsof -ti tcp:8790
kill -9 ...
nohup bash /home/rc/doc-assistant-deploy/run-doc-assistant.sh ...
tail -n 20 ...
curl http://127.0.0.1:8790/health
curl http://127.0.0.1:8790/api/doc-assistant/status
```

如果你后面想把这一套再收敛成一个一键脚本，可以基于这份文档继续封装。

## 直接试问答

### 本地 extractive 模式

```bash
cd learn/doc-assistant-design
npm run ask -- --docs-root /path/to/docs --question "How do I configure push settings for the iOS Call SDK?"
```

### 真实模型 agent 模式

```bash
cd learn/doc-assistant-design
npm run ask -- --mode agent --docs-root /path/to/docs --question "How do I start and accept a 1-to-1 call in the iOS Call SDK?"
```

如果当前目录下有 `.env`，CLI 会自动读取：

```env
DOC_ASSISTANT_DOCS_ROOT=/path/to/docs
DOC_ASSISTANT_BASE_URL=https://example.com/v1
DOC_ASSISTANT_API_KEY=sk-...
DOC_ASSISTANT_MODEL=gpt-5.4-mini
```

CLI 输出会包含：

- top retrieval 命中列表
- 最终答案
- summary
- 实际使用的 provider/model

如果你希望 `npm run dev`、`npm run ask`、`npm run eval` 默认都指向同一个文档库，可以在 `.env` 里配置：

```bash
DOC_ASSISTANT_DOCS_ROOT=/Users/admin/Workspace@RongCloud/For-production/rc-new/docs
```

只有在命令行显式传了 `--docs-root` 时，才会覆盖这个默认值。

## 跑内置测试案例

这个 learning 包现在内置了一组评测案例，覆盖：

- 平台区分
- 正式页优先于 archive
- partial 降权
- section intent（start / accept / configure / require）
- 聊天集成与通话结束消息
- 版本发布说明
- no-hit 场景

直接跑：

```bash
cd learn/doc-assistant-design
npm run eval -- --docs-root /path/to/docs
```

只跑某一类案例：

```bash
npm run eval -- --docs-root /path/to/docs --case ios-1to1
```

连最终答案一起打印：

```bash
npm run eval -- --docs-root /path/to/docs --mode agent --show-answers
```

当前内置案例定义在：

- `src/eval-cases.ts`
- `src/eval.ts`

当前内置案例包括：

- `ios-push-config`
- `ios-1to1-call`
- `ios-install-init`
- `callplus-voip-requirements`
- `ios-group-upgrade`
- `ios-chat-summary-message`
- `ios-release-notes`
- `web-1to1-call`
- `web-push-config`
- `web-group-answer`
- `web-chat-call-log`
- `archive-fallback-allowed`
- `no-hit-kubernetes`

## 当前可用形态

- WebSocket/RPC server
  - 适合学习 control-plane、session、run tracking
- `npm run ask`
  - 适合直接把本地 Markdown 文档库跑成一个可试用的文档助手
- `npm run eval`
  - 适合批量验证当前检索和回答质量是否退化
- HTTP API + WebSocket events
  - 适合接入外部页面或文档站

如果你只是想验证“检索 + 回答”链路，优先用 `npm run ask`。

## HTTP API

启动 server 后，默认还会暴露一组 JSON API：

- `POST /api/doc-assistant/users`
- `POST /api/doc-assistant/search/preview`
- `POST /api/doc-assistant/runs`
- `GET /api/doc-assistant/runs/:runId`
- `GET /api/doc-assistant/runs/:runId/wait?timeoutMs=5000`
- `GET /api/doc-assistant/transcripts/:userId`
- `GET /api/doc-assistant/status`
- `GET /api/doc-assistant/methods`

如果页面还需要实时接收：

- `docs.retrieval`
- `docs.delta`
- `docs.completed`

则页面应先建立 `ws://host:port/ws?clientId=<id>` 连接，再在 HTTP 请求里带：

- `X-Doc-Assistant-Client-Id: <id>`

这样 HTTP 发起的 run 就会把事件推回对应的浏览器连接。

## CORS

如果要给外部站点调用，启动 server 前设置：

```bash
export DOC_ASSISTANT_CORS_ORIGINS="https://docs.example.com,https://staging.example.com"
```

也支持：

```bash
export DOC_ASSISTANT_CORS_ORIGINS="*"
```

## Docusaurus 页面配置

如果要把页面接到 Docusaurus，自定义页需要这两个环境变量：

```bash
DOCUSAURUS_ASSISTANT_HTTP_BASE_URL=https://assistant.example.com/api/doc-assistant
DOCUSAURUS_ASSISTANT_WS_URL=wss://assistant.example.com
```

其中 `DOCUSAURUS_ASSISTANT_WS_URL` 可选；未设置时，页面会根据 HTTP base URL 自动推导。
