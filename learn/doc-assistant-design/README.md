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
- 可用的 `node_modules`
- 文档目录
- 能访问你的 OpenAI-compatible 网关

建议远端目录结构如下：

```text
/home/rc/doc-assistant-deploy/
  run-doc-assistant.sh
  doc-assistant.log
  learn/
    doc-assistant-design/
  gateway-design/
    node_modules/
  rc-new-docs/
```

这里的关键点是：

- `learn/doc-assistant-design` 是实际运行目录
- `gateway-design/node_modules/tsx/dist/loader.mjs` 被复用为 TS loader
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

node --import ../gateway-design/node_modules/tsx/dist/loader.mjs --input-type=module -e "
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
