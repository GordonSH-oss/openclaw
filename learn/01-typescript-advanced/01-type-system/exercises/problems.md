# TypeScript 类型系统 - 练习题

完成以下 5 道编程题，检验你对 TypeScript 高级类型的理解。

## 练习 1：类型安全的配置管理器

### 要求

实现一个类型安全的配置管理器，支持：
1. 泛型配置定义
2. 类型推断
3. 默认值
4. 类型守卫验证

### 代码模板

```typescript
type Config = {
  database: {
    host: string;
    port: number;
    ssl?: boolean;
  };
  cache: {
    enabled: boolean;
    ttl: number;
  };
  logging: {
    level: "debug" | "info" | "warn" | "error";
  };
};

class ConfigManager<T extends Record<string, unknown>> {
  private config: T;

  constructor(config: T) {
    this.config = config;
  }

  // TODO: 实现 get 方法，支持嵌套路径
  // 例如: get("database.host") 应该返回 string
  get<K extends keyof T>(key: K): T[K];
  get(path: string): unknown;
  get(pathOrKey: string): unknown {
    // 你的实现
  }

  // TODO: 实现 set 方法，保证类型安全
  set<K extends keyof T>(key: K, value: T[K]): void {
    // 你的实现
  }

  // TODO: 实现 validate 方法，使用类型守卫
  validate(): boolean {
    // 你的实现
  }
}

// 测试用例
const config = new ConfigManager<Config>({
  database: { host: "localhost", port: 5432 },
  cache: { enabled: true, ttl: 3600 },
  logging: { level: "info" },
});

const host = config.get("database");  // 类型应该是 { host: string; port: number; ssl?: boolean }
config.set("cache", { enabled: false, ttl: 7200 });  // ✅ 类型正确
// config.set("cache", { enabled: "false" });  // ❌ 类型错误
```

### 提示

- 使用泛型约束 `T extends Record<string, unknown>`
- 使用 `keyof` 提取键
- 考虑使用类型守卫验证运行时值

---

## 练习 2：类型级别的路由解析器

### 要求

使用条件类型和 `infer` 实现一个路由解析器，能从路由字符串中提取参数类型。

### 代码模板

```typescript
// TODO: 实现 ExtractParams 类型
// 从路由字符串提取参数名
type ExtractParams<T extends string> = 
  /* 你的实现 */;

// 测试用例
type Route1 = "/users/:userId/posts/:postId";
type Params1 = ExtractParams<Route1>;
// 应该是: { userId: string; postId: string }

type Route2 = "/products/:id";
type Params2 = ExtractParams<Route2>;
// 应该是: { id: string }

type Route3 = "/home";
type Params3 = ExtractParams<Route3>;
// 应该是: {}

// TODO: 实现类型安全的路由处理器
type RouteHandler<R extends string> = (params: ExtractParams<R>) => void;

const handleUserPost: RouteHandler<"/users/:userId/posts/:postId"> = (params) => {
  // params 的类型应该自动推断为 { userId: string; postId: string }
  console.log(params.userId, params.postId);
};
```

### 提示

- 使用条件类型递归提取参数
- 使用 `infer` 推断参数名
- 考虑字符串模板类型 (`${...}`)

---

## 练习 3：事件系统的判别联合

### 要求

设计一个类型安全的事件系统，使用判别联合表示不同的事件类型。

### 代码模板

```typescript
// TODO: 定义事件类型（判别联合）
type Event =
  | { type: "login"; userId: string; timestamp: number }
  | { type: "logout"; userId: string; reason: string }
  | { type: "message"; from: string; to: string; content: string }
  | { type: "error"; code: number; message: string };

// TODO: 实现类型安全的事件处理器
class EventBus {
  private handlers: Map<Event["type"], Array<(event: Event) => void>> = new Map();

  // 注册事件处理器，确保类型安全
  on<T extends Event["type"]>(
    eventType: T,
    handler: (event: Extract<Event, { type: T }>) => void
  ): void {
    // 你的实现
  }

  // 触发事件
  emit(event: Event): void {
    // 你的实现
  }
}

// 测试用例
const bus = new EventBus();

bus.on("login", (event) => {
  // event 的类型应该是 { type: "login"; userId: string; timestamp: number }
  console.log(`User ${event.userId} logged in at ${event.timestamp}`);
});

bus.on("message", (event) => {
  // event 的类型应该是 { type: "message"; from: string; to: string; content: string }
  console.log(`${event.from} -> ${event.to}: ${event.content}`);
});

bus.emit({ type: "login", userId: "123", timestamp: Date.now() });
// bus.emit({ type: "login", userId: 123 });  // ❌ 类型错误
```

### 提示

- 使用 `Extract` 工具类型过滤判别联合
- 利用 TypeScript 的类型缩小
- 考虑使用 `switch` 语句穷尽性检查

---

## 练习 4：深度只读工具类型

### 要求

实现一个 `DeepReadonly<T>` 类型，递归地将对象的所有嵌套属性设为只读。

### 代码模板

```typescript
// TODO: 实现 DeepReadonly
type DeepReadonly<T> = 
  /* 你的实现 */;

// 测试用例
type User = {
  id: string;
  profile: {
    name: string;
    address: {
      street: string;
      city: string;
      coordinates: {
        lat: number;
        lng: number;
      };
    };
  };
  tags: string[];
};

type ReadonlyUser = DeepReadonly<User>;

const user: ReadonlyUser = {
  id: "123",
  profile: {
    name: "Alice",
    address: {
      street: "Main St",
      city: "NYC",
      coordinates: { lat: 40.7128, lng: -74.0060 },
    },
  },
  tags: ["admin", "user"],
};

// user.id = "456";  // ❌ 只读属性
// user.profile.name = "Bob";  // ❌ 深度只读
// user.profile.address.city = "LA";  // ❌ 深度只读
// user.tags.push("guest");  // ❌ 数组也是只读
```

### 提示

- 使用映射类型 `[K in keyof T]`
- 使用条件类型检查是否为对象
- 处理特殊情况（数组、函数、原始类型）
- 考虑递归深度限制

### 扩展挑战

实现 `DeepWritable<T>` 类型，与 `DeepReadonly<T>` 相反，移除所有 `readonly` 修饰符。

---

## 练习 5：运行时类型检查函数

### 要求

编写类型守卫函数，对复杂对象进行运行时类型检查。

### 代码模板

```typescript
// TODO: 实现类型守卫
function isString(value: unknown): value is string {
  // 你的实现
}

function isNumber(value: unknown): value is number {
  // 你的实现
}

function isArray<T>(
  value: unknown,
  itemGuard: (item: unknown) => item is T
): value is T[] {
  // 你的实现
}

// 复杂对象的类型守卫
type User = {
  id: string;
  name: string;
  age: number;
  email?: string;
};

function isUser(value: unknown): value is User {
  // TODO: 实现完整的类型检查
  // 你的实现
}

// TODO: 实现泛型类型守卫生成器
function createObjectGuard<T extends Record<string, unknown>>(
  schema: {
    [K in keyof T]: (value: unknown) => value is T[K];
  }
): (value: unknown) => value is T {
  // 你的实现
}

// 测试用例
const userGuard = createObjectGuard<User>({
  id: isString,
  name: isString,
  age: isNumber,
  email: (v): v is string | undefined => v === undefined || isString(v),
});

const data: unknown = { id: "123", name: "Alice", age: 30 };

if (userGuard(data)) {
  // data 的类型被缩小为 User
  console.log(data.name.toUpperCase());
}
```

### 提示

- 使用 `typeof` 和 `instanceof` 进行基本类型检查
- 使用 `in` 操作符检查属性存在
- 对于对象，需要逐个验证属性
- 考虑可选属性和 `undefined`

---

## 提交要求

1. 所有代码必须通过 TypeScript 编译（`tsc --strict`）
2. 测试用例必须能够运行且通过
3. 添加注释解释关键的类型推导
4. 遵循 TypeScript 最佳实践

## 评分标准

- **类型安全性** (40%)：类型定义准确，无类型错误
- **代码质量** (30%)：代码清晰，可读性强
- **功能完整性** (20%)：实现所有要求的功能
- **扩展性** (10%)：代码设计具有良好的扩展性

## 参考答案

参考答案在 [solutions/](./solutions/) 目录中，建议先尝试自己实现。

---

**祝你好运！记住：类型系统是编译时的好友，运行时的守护者。**