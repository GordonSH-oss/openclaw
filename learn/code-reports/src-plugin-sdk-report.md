# OpenClaw `src/plugin-sdk` 深读报告

## 1. 模块定位

`src/plugin-sdk` 是 OpenClaw 对插件暴露的公共合同层。它的意义不是“把一些 helper 整理出来”，而是明确划出一条边界：

- 插件作者能依赖什么
- core 可以如何演进而不把外部插件全部打碎
- bundled plugin 和第三方插件应该共享哪些 contract

这层的关键价值是“边界稳定性”，而不是复杂算法。

## 2. 结构特点

从 `package.json` 的 exports 和 `docs/plugins/sdk-overview.md` 可以看出，`plugin-sdk` 是按 subpath 划分的：

- `plugin-sdk/plugin-entry`
- `plugin-sdk/core`
- `plugin-sdk/provider-entry`
- `plugin-sdk/channel-contract`
- `plugin-sdk/runtime`

以及大量更细的 runtime / helper subpaths。

这种设计的好处：

- 避免插件一上来 import 一个巨大的入口
- 减少循环依赖和启动负担
- 让不同能力面有更清晰的 contract

## 3. 为什么它值得学

`src/plugin-sdk` 很值得学习，不是因为它代码量最大，而是因为它把插件平台真正抽象成了“公共 API”。

这里最应该关注的是三件事：

### 3.1 subpath import 是故意设计，不是风格问题

OpenClaw 明确要求从具体 subpath import，而不是一个大而全的入口。这是为了：

- 控制依赖边界
- 减少启动开销
- 让 contract 粒度清楚

### 3.2 register(api) 的 API 面才是插件编程模型

插件不是随意往 core 里塞对象，而是通过受控的 API 注册能力。

### 3.3 文档、exports、测试、源码必须同步

对 `plugin-sdk` 的改动不只是源码改动，也是 contract 改动。它需要和：

- docs
- package exports
- API baseline
- contract tests

一起维护。

## 4. 推荐阅读顺序

1. `docs/plugins/sdk-overview.md`
2. `src/plugin-sdk/AGENTS.md`
3. `src/plugin-sdk/plugin-entry.ts`
4. `src/plugin-sdk/core.ts`
5. `src/plugin-sdk/provider-entry.ts`
6. `src/plugin-sdk/channel-contract.ts`
7. `src/plugin-sdk/runtime.ts`

## 5. 与 `learn/plugin-design` 的关系

学习版没有复制 `src/plugin-sdk` 的大量 subpath，而是把它压缩成一个更适合学习的最小边界：

- `learn/plugin-design/src/plugin-api.ts`
  - 承担学习版 Plugin SDK 的角色
- `registerProvider`
- `registerChannel`
- `registerTool`
- `registerGatewayMethod`
- `registerHook`
- `registerMemoryRuntime`

这样做的目的不是弱化 `plugin-sdk`，而是先把“为什么需要一个公共 contract 层”讲明白。等你理解了这层，再回去看真实 `src/plugin-sdk` 的 100+ subpaths，就不会只觉得它“文件很多”。它其实是在把插件平台拆成稳定的公共合同。
