# Mini Plugin Design

`learn/plugin-design` 是一个用于学习 OpenClaw `src/plugins` 和 `src/plugin-sdk` 的教学包。重点不是做一个完整插件生态，而是把最关键的三层讲清楚：

- manifest-first discovery
- `register(api)` capability registration
- registry 作为系统消费面

## 当前结构

```text
src/
  manifest.ts
  discovery.ts
  enablement.ts
  plugin-api.ts
  registry.ts
  loader.ts
  runtime.ts
  fixtures/plugins/*
  index.ts
```

## 学习重点

### 1. 为什么要先读 manifest，再决定是否加载 runtime

真实 OpenClaw 的一个关键设计是：很多配置校验、发现、启用状态判断，应该在不执行插件代码的前提下完成。学习版保留了这个主线：

- `manifest.ts` 负责插件静态合同
- `discovery.ts` 先发现 candidate
- `enablement.ts` 再决定是否启用
- `loader.ts` 最后才真正 import runtime entry

### 2. 为什么 Plugin SDK 是边界，而不是随便 import core

学习版的 `plugin-api.ts` 就是最小 Plugin SDK。插件只能通过这个 API 注册能力，不能直接修改 registry 内部结构。

### 3. 为什么 registry 是系统消费面

runtime 真正注册完之后，其他系统看的不是“某个插件模块本身”，而是 registry：

- 哪些 provider 可用
- 哪些 channel 可用
- 哪些 tools / gateway methods / hooks 可用
- 当前 memory runtime 是谁

## 推荐阅读顺序

1. `src/manifest.ts`
2. `src/discovery.ts`
3. `src/enablement.ts`
4. `src/plugin-api.ts`
5. `src/registry.ts`
6. `src/loader.ts`
7. `src/runtime.ts`
8. `src/fixtures/plugins/*`

## 和 OpenClaw 的差异

- 不做真实 `jiti`、npm 安装、marketplace、安全扫描
- 不做完整 100+ SDK subpaths
- 只保留 provider/channel/tool/gatewayMethod/hook/memoryRuntime 这些最关键能力
- fixture plugin 都是本地 deterministic mock，用来讲清控制流
