/**
 * 03 - 类型推断（Type Inference）
 * 
 * 学习目标：
 * 1. 理解 TypeScript 的类型推断机制
 * 2. 学会何时需要显式类型注解
 * 3. 掌握泛型的类型推断
 * 4. 理解 typeof 和 ReturnType
 * 
 * 预计时间：10 分钟
 */

// ============================================================================
// 1. 基础类型推断
// ============================================================================

// TypeScript 会自动推断变量类型
let num = 42;              // 推断为 number
let str = "hello";         // 推断为 string
let bool = true;           // 推断为 boolean
let arr = [1, 2, 3];       // 推断为 number[]
let tuple = [1, "two"];    // 推断为 (string | number)[]

// 可以使用 as const 获取更精确的类型
let exactNum = 42 as const;     // 42（字面量类型）
let exactStr = "hello" as const; // "hello"（字面量类型）

console.log("✅ 基础类型推断");

// ============================================================================
// 2. 函数返回值推断
// ============================================================================

// 返回值类型会被自动推断
function add(a: number, b: number) {
  return a + b;  // 推断返回 number
}

function greet(name: string) {
  return `Hello, ${name}!`;  // 推断返回 string
}

// 获取函数的返回类型
type AddResult = ReturnType<typeof add>;      // number
type GreetResult = ReturnType<typeof greet>;  // string

console.log("✅ 函数返回值推断:", add(1, 2), greet("Alice"));

// ============================================================================
// 3. 泛型函数的类型推断
// ============================================================================

// TypeScript 会从参数推断泛型类型
function identity<T>(value: T): T {
  return value;
}

// 不需要显式指定 <number>，TypeScript 会自动推断
const num1 = identity(42);        // T 被推断为 number
const str1 = identity("hello");   // T 被推断为 string

// 有时需要显式指定
const arr1 = identity<number[]>([]);  // 空数组需要指定类型

console.log("✅ 泛型类型推断:", num1, str1);

// ============================================================================
// 4. 上下文类型推断（Contextual Typing）
// ============================================================================

// TypeScript 根据上下文推断类型
const numbers: number[] = [1, 2, 3];

// forEach 的回调参数类型会被推断
numbers.forEach((num) => {
  // num 被推断为 number
  console.log(num.toFixed(2));
});

// map 的返回值类型也会被推断
const strings = numbers.map((num) => {
  return `#${num}`;  // 返回值被推断为 string
});

console.log("✅ 上下文类型推断:", strings);

// ============================================================================
// 5. 对象字面量的类型推断
// ============================================================================

// 对象字面量会被推断为具体的类型
const user = {
  name: "Alice",
  age: 30,
  email: "alice@example.com"
};

// user 的类型被推断为:
// {
//   name: string;
//   age: number;
//   email: string;
// }

// 使用 typeof 获取推断的类型
type User = typeof user;

// 使用 keyof 获取所有键
type UserKeys = keyof User;  // "name" | "age" | "email"

console.log("✅ 对象类型推断");

// ============================================================================
// 6. 最佳通用类型（Best Common Type）
// ============================================================================

// TypeScript 会找到最佳通用类型
let mixed = [1, 2, "three"];    // (string | number)[]
let numbers2 = [1, 2, 3];       // number[]

// 当无法推断时，使用 union
let union = [1, "two", true];   // (string | number | boolean)[]

console.log("✅ 最佳通用类型推断");

// ============================================================================
// 7. 从 Schema 推断类型（OpenClaw 模式）
// ============================================================================

// 模拟 TypeBox 的 Static 类型推断
const UserSchema = {
  type: "object" as const,
  properties: {
    id: { type: "number" as const },
    name: { type: "string" as const },
    email: { type: "string" as const }
  },
  required: ["id", "name"] as const
};

// 从 Schema 推断类型
type UserFromSchema = {
  id: number;
  name: string;
  email?: string;
};

const userFromSchema: UserFromSchema = {
  id: 1,
  name: "Alice"
};

console.log("✅ Schema 类型推断:", userFromSchema);

// ============================================================================
// 8. 复杂推断：从函数签名推断参数和返回值
// ============================================================================

// 工具类型：提取函数参数类型
type Parameters<T> = T extends (...args: infer P) => any ? P : never;

// 工具类型：提取函数返回类型
type ReturnType<T> = T extends (...args: any[]) => infer R ? R : never;

function calculate(a: number, b: number): string {
  return `${a + b}`;
}

type CalcParams = Parameters<typeof calculate>;  // [number, number]
type CalcReturn = ReturnType<typeof calculate>;  // string

console.log("✅ 函数签名推断");

// ============================================================================
// 9. 类型推断的边界
// ============================================================================

// ❌ 推断失败的情况
let empty = [];  // any[] （需要显式类型）

// ✅ 解决方案1：立即赋值
let nums1 = [1, 2, 3];  // number[]

// ✅ 解决方案2：显式类型注解
let nums2: number[] = [];

// ✅ 解决方案3：使用泛型
function createArray<T>(...items: T[]): T[] {
  return items;
}

const nums3 = createArray(1, 2, 3);  // number[]

console.log("✅ 类型推断边界处理");

// ============================================================================
// 10. 实战：配置对象的类型推断
// ============================================================================

// OpenClaw 风格的配置定义
const CONFIG = {
  gateway: {
    port: 18789,
    host: "localhost" as const,
    tls: {
      enabled: false,
      cert: null as string | null
    }
  },
  plugins: {
    enabled: true,
    directories: ["./plugins"]
  }
} as const;

// 从配置对象推断类型
type Config = typeof CONFIG;
type GatewayConfig = Config["gateway"];
type TlsConfig = GatewayConfig["tls"];

// 类型安全的配置访问
function getConfigValue<K extends keyof typeof CONFIG>(key: K) {
  return CONFIG[key];
}

const gateway = getConfigValue("gateway");
console.log("✅ 配置类型推断:", gateway.port);

// ============================================================================
// 练习题
// ============================================================================

/**
 * 练习 1：实现类型推断的 createPair 函数
 * 
 * 要求：根据传入的参数自动推断键和值的类型
 */

// TODO: 实现这个函数（不要显式写返回值类型）
// function createPair(key, value) {
//   return { key, value };
// }

// 测试：应该自动推断类型
// const pair1 = createPair("age", 30);     // { key: string; value: number }
// const pair2 = createPair(1, "first");    // { key: number; value: string }

/**
 * 练习 2：实现类型推断的数组转对象
 * 
 * 要求：将数组转换为对象，自动推断键和值的类型
 * 
 * 示例：
 * arrayToObject(["a", "b"], [1, 2]) => { a: 1, b: 2 }
 */

// TODO: 实现这个函数
// function arrayToObject(keys, values) {
//   // 你的代码
// }

/**
 * 练习 3：实现类型推断的状态机
 * 
 * 要求：根据传入的状态自动推断类型
 */

// TODO: 实现这个函数
// function createStateMachine(initialState) {
//   let state = initialState;
//   return {
//     getState: () => state,
//     setState: (newState: typeof state) => { state = newState; }
//   };
// }

// ============================================================================
// 参考答案
// ============================================================================

// 答案 1
function createPair<K, V>(key: K, value: V) {
  return { key, value };
}

// 答案 2
function arrayToObject<K extends string | number | symbol, V>(
  keys: K[],
  values: V[]
): Record<K, V> {
  const result = {} as Record<K, V>;
  for (let i = 0; i < keys.length; i++) {
    result[keys[i]] = values[i];
  }
  return result;
}

// 答案 3
function createStateMachine<T>(initialState: T) {
  let state = initialState;
  return {
    getState: () => state,
    setState: (newState: T) => {
      state = newState;
    }
  };
}

// 测试答案
console.log("\n===== 练习答案 =====");

const pair1 = createPair("age", 30);
const pair2 = createPair(1, "first");
console.log("练习1:", pair1, pair2);

const obj = arrayToObject(["a", "b", "c"], [1, 2, 3]);
console.log("练习2:", obj);

const machine = createStateMachine({ count: 0 });
console.log("练习3:", machine.getState());
machine.setState({ count: 1 });
console.log("练习3 (更新后):", machine.getState());

// ============================================================================
// 关键要点总结
// ============================================================================

/**
 * 1. TypeScript 的类型推断非常强大，通常不需要显式类型
 * 2. 使用 typeof 获取值的类型
 * 3. 使用 ReturnType 获取函数返回类型
 * 4. 使用 keyof 获取对象的键类型
 * 5. 泛型的类型通常可以从参数自动推断
 * 6. as const 可以获得更精确的字面量类型
 * 
 * 下一步：学习条件类型 (04-conditional-types.ts)
 */
