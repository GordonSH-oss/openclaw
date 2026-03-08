# 01. TypeScript 类型系统进阶

## 学习目标

通过本主题的学习，你将掌握：

1. 泛型与类型推断的高级用法
2. 条件类型与 `infer` 关键字的实战应用
3. 判别联合类型的设计模式
4. 映射类型与工具类型的组合使用
5. 函数重载与类型守卫的最佳实践
6. `satisfies` 和 `as const` 的实用场景

## 内容结构

### 📚 理论学习（约 4 小时）

阅读 [theory/guide.md](./theory/guide.md)，系统学习 TypeScript 类型系统的高级特性。

### 💻 代码示例（约 1.5 小时）

1. **OpenClaw 真实示例** - [examples/openclaw/](./examples/openclaw/)
   - 插件类型系统设计
   - 协议类型推断
   - 工具函数类型守卫

2. **简化示例** - [examples/simplified/](./examples/simplified/)
   - 逐步构建类型安全的插件系统
   - 从简单到复杂的渐进式示例

### ✏️ 练习题（约 2 小时）

完成 [exercises/problems.md](./exercises/problems.md) 中的 5 道编程题：

1. **泛型约束**：实现一个类型安全的配置管理器
2. **条件类型**：构建类型级别的路由解析器
3. **判别联合**：设计事件系统的类型定义
4. **映射类型**：实现深度只读工具类型
5. **类型守卫**：编写运行时类型检查函数

### 🚀 实战项目（约 3 小时）

**项目：构建类型安全的插件系统**

参考 [projects/requirements.md](./projects/requirements.md)，实现一个简化版的插件加载和管理系统。

**核心功能：**
- 插件注册与发现
- 类型安全的插件 API
- 插件配置验证
- Hook 系统

**技术要点：**
- 使用泛型定义插件接口
- 使用条件类型推断插件配置
- 使用判别联合处理不同插件类型
- 使用类型守卫验证运行时类型

## 学习路径

```mermaid
graph LR
    A[理论学习] --> B[OpenClaw 示例分析]
    B --> C[简化示例实践]
    C --> D[完成练习题]
    D --> E[实战项目]
    E --> F[代码审查]
```

## 关键概念速查

| 概念 | 用途 | OpenClaw 示例 |
|------|------|---------------|
| 泛型 `<T>` | 代码复用 + 类型安全 | `Static<T>` 从 Schema 推断类型 |
| 条件类型 `T extends U ? X : Y` | 类型分支逻辑 | 函数签名提取 |
| `infer` | 类型模式匹配 | 推断函数参数类型 |
| 判别联合 | 类型安全的多态 | API 响应类型 |
| 映射类型 `[K in keyof T]` | 类型转换 | Hook 处理器映射 |
| 类型守卫 `is` | 运行时类型检查 | `isAbortSignal()` |
| `satisfies` | 约束 + 推断 | Schema 定义 |
| `as const` | 字面量类型 | 常量数组 |

## OpenClaw 代码导航

学习过程中参考以下 OpenClaw 源码：

### 核心类型定义
- `src/plugins/types.ts` - 插件类型系统
- `src/gateway/protocol/schema/types.ts` - 协议类型推断
- `src/agents/pi-tool-definition-adapter.ts` - 条件类型应用

### 实用工具
- `src/agents/tools/common.ts` - 类型守卫
- `src/plugins/types.ts` - 映射类型
- `src/gateway/protocol/schema/protocol-schemas.ts` - `satisfies` 用法

## 学习检查清单

完成本主题后，你应该能够：

- [ ] 解释泛型的协变和逆变
- [ ] 编写包含 `infer` 的条件类型
- [ ] 设计判别联合类型
- [ ] 使用映射类型创建工具类型
- [ ] 实现函数重载的类型定义
- [ ] 编写运行时类型守卫
- [ ] 正确使用 `satisfies` 和 `as const`
- [ ] 理解 TypeScript 类型推断的工作原理
- [ ] 完成至少 3 道练习题
- [ ] 完成实战项目并通过测试

## 进阶资源

### 推荐阅读
- [TypeScript Handbook - Generics](https://www.typescriptlang.org/docs/handbook/2/generics.html)
- [TypeScript Handbook - Conditional Types](https://www.typescriptlang.org/docs/handbook/2/conditional-types.html)
- [Type Challenges](https://github.com/type-challenges/type-challenges) - 在线类型编程练习

### 相关主题
- 主题 05：Schema 验证 - 将类型系统应用于运行时验证
- 主题 09：依赖注入 - 泛型在 IoC 容器中的应用

## 常见问题

### Q: 什么时候使用泛型，什么时候使用 `any` 或 `unknown`？

**A:** 
- 使用泛型：需要保留类型信息并在后续使用
- 使用 `unknown`：不知道类型但需要类型检查
- 避免 `any`：会破坏类型安全

### Q: 条件类型和函数重载有什么区别？

**A:** 
- 条件类型：编译时的类型级别分支
- 函数重载：为同一函数提供多个类型签名
- 可以组合使用以获得更精确的类型推断

### Q: `satisfies` 和类型断言有什么不同？

**A:**
- `satisfies`：验证类型 + 保留精确类型
- `as`：强制类型转换，可能丢失类型信息
- 优先使用 `satisfies`

## 下一步

完成本主题后，继续学习 [02. 异步编程模式](../02-async-patterns/README.md)
