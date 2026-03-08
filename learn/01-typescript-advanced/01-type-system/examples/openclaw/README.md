# OpenClaw 真实代码示例 - 类型系统

本目录包含从 OpenClaw 代码库中提取的真实类型系统应用示例。

## 文件说明

### 01-plugin-types.ts
插件系统的完整类型定义，展示：
- 泛型与类型推断
- 判别联合
- 映射类型

**源文件**: `src/plugins/types.ts`

### 02-protocol-types.ts
Gateway 协议类型定义，展示：
- TypeBox Schema 类型推断
- 条件类型
- 类型工具

**源文件**: `src/gateway/protocol/schema/types.ts`

### 03-tool-adapter.ts
工具定义适配器，展示：
- 条件类型与 `infer`
- 函数签名提取
- 类型兼容性处理

**源文件**: `src/agents/pi-tool-definition-adapter.ts`

### 04-type-guards.ts
实用类型守卫函数，展示：
- 类型谓词
- 运行时类型检查
- 类型缩小

**源文件**: `src/agents/tools/common.ts`

### 05-hook-registry.ts
Hook 注册表，展示：
- 映射类型
- 类型安全的事件系统
- 泛型约束

**源文件**: `src/plugins/hooks.ts`

## 学习路径

建议按以下顺序学习：

1. **01-plugin-types.ts** - 理解插件系统的类型架构
2. **02-protocol-types.ts** - 学习 Schema 到类型的转换
3. **03-tool-adapter.ts** - 掌握条件类型的实战应用
4. **04-type-guards.ts** - 实现运行时类型验证
5. **05-hook-registry.ts** - 构建类型安全的事件系统

## 关键概念对照表

| 文件 | 主要概念 | OpenClaw 应用场景 |
|------|----------|-------------------|
| 01-plugin-types.ts | 判别联合、映射类型 | 插件配置验证 |
| 02-protocol-types.ts | `Static<T>`、类型推断 | Gateway RPC 协议 |
| 03-tool-adapter.ts | 条件类型、`infer` | 工具 API 兼容性 |
| 04-type-guards.ts | 类型守卫、`is` | 运行时验证 |
| 05-hook-registry.ts | 泛型、`keyof` | Hook 系统 |

## 代码阅读提示

### 关注点

1. **类型定义的位置**：通常在文件开头
2. **类型约束**：`extends` 关键字的使用
3. **类型推断**：TypeScript 自动推断的类型
4. **类型守卫**：`is` 谓词的使用
5. **工具类型**：`Partial`、`Pick`、`Omit` 等

### 如何阅读

1. **第一遍**：浏览整体结构，理解类型定义
2. **第二遍**：深入理解每个类型的作用
3. **第三遍**：查看类型如何在运行时代码中使用
4. **第四遍**：尝试修改类型，观察错误信息

## 与简化示例对比

每个 OpenClaw 示例都有对应的简化版本（`../simplified/` 目录），建议：

1. 先看简化版理解核心概念
2. 再看 OpenClaw 版理解生产级应用
3. 对比两者，理解工程化差异

## 调试技巧

### 使用 TypeScript Playground

将代码粘贴到 [TypeScript Playground](https://www.typescriptlang.org/play) 中：
1. 悬停在类型上查看推断结果
2. 尝试修改代码观察类型错误
3. 使用"Show Emit"查看编译后的 JavaScript

### 使用 IDE 功能

在 VSCode 中：
- **Ctrl/Cmd + Click**：跳转到类型定义
- **F12**：查看类型实现
- **Shift + F12**：查找所有引用
- **Hover**：查看类型信息

### 类型检查命令

```bash
# 检查单个文件
npx tsc --noEmit --strict filename.ts

# 查看类型推断
npx tsc --noEmit --strict --listEmittedFiles filename.ts
```

## 常见问题

### Q: 为什么 OpenClaw 使用这么多泛型？

**A:** 泛型提供了代码复用和类型安全的双重优势。在插件系统中，泛型允许：
- 不同插件有不同的配置类型
- 编译时保证类型安全
- 减少运行时错误

### Q: 条件类型什么时候使用？

**A:** 当类型需要根据输入动态决定时。例如：
- 函数重载的精确类型推断
- 从一个类型派生另一个类型
- 类型级别的条件逻辑

### Q: 类型守卫和类型断言有什么区别？

**A:** 
- **类型守卫**：运行时检查 + 类型缩小（安全）
- **类型断言**：编译时强制类型（不安全）

优先使用类型守卫。

## 下一步

学完 OpenClaw 示例后，尝试：

1. 完成 [exercises/problems.md](../exercises/problems.md) 中的练习
2. 参考 [simplified/](../simplified/) 中的渐进式示例
3. 开始实战项目：构建自己的插件系统

---

**Happy coding!**