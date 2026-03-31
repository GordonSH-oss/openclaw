# Learn Doc Assistant

`learn/doc-assistant-design` 是一个用于学习“本地 Markdown 文档问答”控制面的示例包。它复用了 `learn/gateway-design` 的核心心智模型，但把业务目标换成了技术文档助手：

- 通过 WebSocket/RPC 暴露问答接口
- 给调用方分配临时 user id
- 把 user id 绑定到稳定 session
- 每次提问都重建本地 Markdown 索引并检索
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
node --import ../gateway-design/node_modules/tsx/dist/loader.mjs src/index.ts
npm test
```

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
