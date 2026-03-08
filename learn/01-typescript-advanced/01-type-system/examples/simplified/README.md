# 简化示例 - TypeScript 类型系统

本目录包含从简单到复杂的渐进式示例，帮助你逐步理解 TypeScript 类型系统。

## 学习路径

### 阶段 1：基础泛型（30分钟）
- `01-basic-generics.ts` - 泛型函数和类
- `02-generic-constraints.ts` - 泛型约束
- `03-type-inference.ts` - 类型推断

### 阶段 2：条件类型（45分钟）
- `04-conditional-types.ts` - 条件类型基础
- `05-infer-keyword.ts` - `infer` 关键字
- `06-advanced-conditional.ts` - 高级条件类型

### 阶段 3：联合与映射（45分钟）
- `07-union-types.ts` - 联合类型
- `08-discriminated-unions.ts` - 判别联合
- `09-mapped-types.ts` - 映射类型

### 阶段 4：实用技巧（60分钟）
- `10-type-guards.ts` - 类型守卫
- `11-satisfies-const.ts` - satisfies 与 as const
- `12-utility-types.ts` - 工具类型

### 阶段 5：综合实战（90分钟）
- `13-plugin-system-simple.ts` - 简化插件系统（第1版）
- `14-plugin-system-advanced.ts` - 改进版插件系统（第2版）
- `15-plugin-system-complete.ts` - 完整插件系统（第3版）

## 文件说明

每个文件包含：
1. **概念介绍** - 简要说明要学习的内容
2. **代码示例** - 可运行的完整代码
3. **注释说明** - 详细的代码注释
4. **练习任务** - 文件末尾的小练习
5. **参考答案** - 练习的参考实现

## 如何使用

### 方式 1：在线运行

将代码粘贴到 [TypeScript Playground](https://www.typescriptlang.org/play)

### 方式 2：本地运行

```bash
# 安装 ts-node
npm install -g ts-node typescript

# 运行示例
ts-node 01-basic-generics.ts

# 或使用 bun
bun run 01-basic-generics.ts
```

### 方式 3：VSCode 中学习

1. 打开示例文件
2. 悬停在类型上查看推断结果
3. 尝试修改代码观察错误
4. 使用 TypeScript 语言服务的智能提示

## 学习建议

### 循序渐进

不要跳过任何示例，每个示例都建立在前一个的基础上。

### 动手实践

不要只是阅读代码，一定要：
1. 自己敲一遍代码
2. 尝试修改代码
3. 观察类型错误
4. 完成文件末尾的练习

### 对比学习

每个简化示例都有对应的 OpenClaw 真实代码：
- 先学习简化版理解概念
- 再看真实代码理解工程实践
- 对比差异，思考原因

### 常见错误

#### 错误 1：类型推断失败

```typescript
// ❌ 错误：推断为 any[]
const items = [];
items.push(1);

// ✅ 正确：显式类型注解
const items: number[] = [];
items.push(1);
```

#### 错误 2：过度使用 any

```typescript
// ❌ 错误：破坏类型安全
function process(data: any) {
  return data.value;
}

// ✅ 正确：使用泛型
function process<T extends { value: unknown }>(data: T) {
  return data.value;
}
```

#### 错误 3：忽略类型守卫

```typescript
// ❌ 错误：运行时可能出错
function getLength(value: string | number) {
  return value.length;  // number 没有 length
}

// ✅ 正确：使用类型守卫
function getLength(value: string | number) {
  if (typeof value === "string") {
    return value.length;
  }
  return value.toString().length;
}
```

## 进度追踪

使用这个清单追踪你的学习进度：

- [ ] 01-basic-generics.ts
- [ ] 02-generic-constraints.ts
- [ ] 03-type-inference.ts
- [ ] 04-conditional-types.ts
- [ ] 05-infer-keyword.ts
- [ ] 06-advanced-conditional.ts
- [ ] 07-union-types.ts
- [ ] 08-discriminated-unions.ts
- [ ] 09-mapped-types.ts
- [ ] 10-type-guards.ts
- [ ] 11-satisfies-const.ts
- [ ] 12-utility-types.ts
- [ ] 13-plugin-system-simple.ts
- [ ] 14-plugin-system-advanced.ts
- [ ] 15-plugin-system-complete.ts

## 获取帮助

遇到问题时：

1. **查看注释**：代码注释中有详细说明
2. **查看错误信息**：TypeScript 错误通常很有帮助
3. **对比 OpenClaw**：参考真实代码的实现
4. **查阅文档**：[TypeScript Handbook](https://www.typescriptlang.org/docs/)

## 推荐资源

### 在线工具
- [TypeScript Playground](https://www.typescriptlang.org/play)
- [Type Challenges](https://github.com/type-challenges/type-challenges)

### 文档
- [TypeScript Handbook](https://www.typescriptlang.org/docs/handbook/intro.html)
- [TypeScript Deep Dive](https://basarat.gitbook.io/typescript/)

### 书籍
- *Effective TypeScript* by Dan Vanderkam
- *Programming TypeScript* by Boris Cherny

## 下一步

完成所有简化示例后，你应该能够：

1. ✅ 编写类型安全的泛型代码
2. ✅ 使用条件类型进行类型转换
3. ✅ 设计判别联合类型
4. ✅ 实现类型守卫
5. ✅ 构建完整的类型安全系统

**然后继续：**
- 完成 [../exercises/problems.md](../exercises/problems.md)
- 开始实战项目：[../projects/requirements.md](../projects/requirements.md)
- 学习下一个主题：[异步编程模式](../../02-async-patterns/README.md)

---

**祝学习愉快！记住：实践是掌握类型系统的唯一途径。**