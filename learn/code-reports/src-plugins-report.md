# OpenClaw `src/plugins` 深读报告

## 1. 模块定位

`src/plugins` 是 OpenClaw 的插件平台后端。它不只是“扫描一下扩展目录”，而是一套完整的插件发现、校验、启用、加载、注册、运行时消费链路。

这层主要解决几个问题：

- 从哪里发现插件
- 发现后如何只靠 manifest 做静态判断
- 哪些插件启用、禁用、被 slot 替换
- 插件 runtime 如何注册 provider / channel / tool / gateway method / hook
- 系统其他模块如何通过 registry 消费插件能力

如果说 `src/gateway` 是控制面，`src/agents` 是执行面，那 `src/plugins` 更像“能力平台层”。

## 2. 目录结构总览

最值得先读的文件：

- `src/plugins/discovery.ts`
- `src/plugins/manifest.ts`
- `src/plugins/loader.ts`
- `src/plugins/registry.ts`
- `src/plugins/runtime.ts`
- `src/plugins/types.ts`

配套边界文件：

- `src/plugins/AGENTS.md`
- `docs/plugins/architecture.md`
- `docs/plugins/sdk-overview.md`

## 3. 主执行链路

一次典型插件加载，大致会经过：

1. `discovery.ts`
   - 根据 root、load path、bundled dir 发现 candidate
2. `manifest.ts`
   - 读取 `openclaw.plugin.json` 和 package metadata
3. `config-state.ts` / enablement 相关逻辑
   - 决定插件是否启用、是否占用 slot
4. `loader.ts`
   - 真正 import runtime entry，并执行 `register(api)`
5. `registry.ts`
   - 形成系统消费用的 capability registry
6. `runtime.ts`
   - 暴露 active plugin registry 给其他模块读取

这里最值得注意的是：

- discovery 和 manifest 判断尽量不执行插件代码
- 真正执行 runtime register 是 loader 的职责
- registry 是最终消费面，不是某个插件模块本身

## 4. 设计特征

### 4.1 manifest-first

OpenClaw 刻意把 discovery 和 runtime load 分开。这样很多事情可以在“不执行插件代码”的情况下完成：

- 配置校验
- 启用状态判断
- 缺失插件提示
- setup / doctor / inspect

### 4.2 capability registration 是一等模型

插件不是一个随意注入代码的黑箱，而是通过 capability 注册进入系统：

- provider
- channel
- tool
- gateway method
- hook
- memory runtime

这使得插件平台更可解释，也更容易测试。

### 4.3 registry 才是系统消费面

系统其他模块真正消费的不是“某个插件文件”，而是 registry：

- 有哪些 provider
- 有哪些 channel
- 当前 memory runtime 是谁
- gateway 多出来了哪些方法

### 4.4 Plugin SDK 是边界

`src/plugin-sdk` 明确告诉插件作者应该 import 哪些入口。生产代码不应该绕过它直接 deep import `src/**`。

## 5. 学习路径建议

推荐按这个顺序读：

1. `docs/plugins/architecture.md`
2. `src/plugins/AGENTS.md`
3. `src/plugins/manifest.ts`
4. `src/plugins/discovery.ts`
5. `src/plugins/registry.ts`
6. `src/plugins/loader.ts`
7. `src/plugin-sdk/core.ts`
8. `src/plugin-sdk/plugin-entry.ts`

## 6. 与 `learn/plugin-design` 的映射

为了把插件平台这条主线做成可运行的学习工程，`learn/plugin-design` 现在映射了几个关键骨架：

- `manifest.ts`
  - 对应 `src/plugins/manifest.ts`
  - 学习版保留 plugin manifest 类型、校验和 entry 解析。
- `discovery.ts`
  - 对应 `src/plugins/discovery.ts`
  - 学习版保留 manifest-first discovery，只发现允许 root 下的插件。
- `enablement.ts`
  - 对应真实系统里 config-state / slot 决策的一部分
  - 学习版保留 disabled plugin 和 memory slot 替换语义。
- `plugin-api.ts`
  - 对应 `src/plugin-sdk/*` 的最小学习版
  - 学习版保留 `register(api)` 模式和 capability registration。
- `registry.ts`
  - 对应 `src/plugins/registry.ts`
  - 学习版保留 provider/channel/tool/gatewayMethod/hook/memoryRuntime 六类消费面。
- `loader.ts`
  - 对应 `src/plugins/loader.ts`
  - 学习版保留“先 discover + enablement，再 import runtime entry”的主链。

学习版刻意不实现：

- 真实 `jiti` 加载策略
- npm 安装 / marketplace
- 安全扫描和所有权检查
- 大规模 capability 细分

保留的是最值得掌握的边界：manifest-first、register(api)、registry consumption、SDK boundary。
