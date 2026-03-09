/**
 * 02 - 泛型约束（Generic Constraints）
 * 
 * 学习目标：
 * 1. 理解为什么需要泛型约束
 * 2. 学会使用 extends 限制泛型
 * 3. 掌握多重约束
 * 4. 理解 keyof 约束
 * 
 * 预计时间：10 分钟
 */

// ============================================================================
// 1. 为什么需要泛型约束？
// ============================================================================

// ❌ 问题：没有约束时，我们不能访问类型的属性
// function logLength<T>(value: T): void {
//   console.log(value.length);  // 错误！T 可能没有 length 属性
// }

// ✅ 解决方案：使用 extends 约束泛型
// 约束 T 必须有 length 属性
function logLength<T extends { length: number }>(value: T): void {
  console.log(`长度: ${value.length}`);
}

// 现在可以安全地使用了
logLength("hello");           // string 有 length
logLength([1, 2, 3]);         // array 有 length
logLength({ length: 10 });    // 对象有 length
// logLength(42);             // 错误！number 没有 length

console.log("✅ 泛型约束基础测试通过");

// ============================================================================
// 2. 使用接口作为约束
// ============================================================================

// 定义接口
interface HasId {
  id: string | number;
}

// 约束 T 必须实现 HasId 接口
function printId<T extends HasId>(obj: T): void {
  console.log(`ID: ${obj.id}`);
}

// 使用示例
printId({ id: 123, name: "Alice" });
printId({ id: "abc", title: "Title" });
// printId({ name: "Bob" }); // 错误！缺少 id 属性

console.log("✅ 接口约束测试通过");

// ============================================================================
// 3. 实战例子：获取对象属性
// ============================================================================

// 不安全的方式（没有约束）
// function getProperty<T, K>(obj: T, key: K) {
//   return obj[key];  // 错误！K 可能不是 T 的键
// }

// ✅ 使用 keyof 约束
// K 必须是 T 的键
function getProperty<T, K extends keyof T>(obj: T, key: K): T[K] {
  return obj[key];
}

const person = {
  name: "Alice",
  age: 30,
  email: "alice@example.com"
};

const name = getProperty(person, "name");   // string
const age = getProperty(person, "age");     // number
// const invalid = getProperty(person, "invalid"); // 错误！

console.log("✅ keyof 约束:", { name, age });

// ============================================================================
// 4. 多重约束
// ============================================================================

// 同时满足多个接口
interface Nameable {
  name: string;
}

interface Ageable {
  age: number;
}

// T 必须同时实现两个接口
function introduce<T extends Nameable & Ageable>(person: T): string {
  return `我是 ${person.name}，今年 ${person.age} 岁`;
}

const alice = { name: "Alice", age: 30, city: "Beijing" };
console.log("✅ 多重约束:", introduce(alice));

// ============================================================================
// 5. 约束的传递
// ============================================================================

// 约束可以相互引用
function copyFields<T extends U, U>(target: T, source: U): T {
  // T 必须是 U 的子类型
  return Object.assign(target, source);
}

interface Person {
  name: string;
}

interface Employee extends Person {
  employeeId: number;
}

const employee: Employee = { name: "Bob", employeeId: 123 };
const person: Person = { name: "Alice" };

// employee 是 Person 的子类型，可以复制
const result = copyFields(employee, person);
console.log("✅ 约束传递:", result);

// ============================================================================
// 6. 实用案例：类型安全的排序
// ============================================================================

// 定义可比较的接口
interface Comparable {
  compareTo(other: this): number;
}

// 约束 T 必须是可比较的
function sort<T extends Comparable>(items: T[]): T[] {
  return items.slice().sort((a, b) => a.compareTo(b));
}

// 实现可比较的类
class Score implements Comparable {
  constructor(public value: number) {}

  compareTo(other: Score): number {
    return this.value - other.value;
  }
}

const scores = [
  new Score(85),
  new Score(92),
  new Score(78),
  new Score(95)
];

const sorted = sort(scores);
console.log("✅ 排序:", sorted.map(s => s.value)); // [78, 85, 92, 95]

// ============================================================================
// 7. 约束泛型类
// ============================================================================

// Repository 模式，约束实体必须有 id
interface Entity {
  id: string | number;
}

class Repository<T extends Entity> {
  private items: Map<string | number, T> = new Map();

  add(item: T): void {
    this.items.set(item.id, item);
  }

  findById(id: string | number): T | undefined {
    return this.items.get(id);
  }

  getAll(): T[] {
    return Array.from(this.items.values());
  }

  remove(id: string | number): boolean {
    return this.items.delete(id);
  }
}

// 使用示例
interface User extends Entity {
  id: number;
  username: string;
  email: string;
}

const userRepo = new Repository<User>();
userRepo.add({ id: 1, username: "alice", email: "alice@example.com" });
userRepo.add({ id: 2, username: "bob", email: "bob@example.com" });

console.log("✅ Repository:", userRepo.findById(1));
console.log("✅ All users:", userRepo.getAll());

// ============================================================================
// 8. OpenClaw 风格：配置对象约束
// ============================================================================

// 模拟 OpenClaw 的配置访问模式
type Config = {
  database: {
    host: string;
    port: number;
  };
  cache: {
    enabled: boolean;
    ttl: number;
  };
};

// 约束 K 必须是 Config 的键
function getConfig<K extends keyof Config>(key: K): Config[K] {
  const config: Config = {
    database: { host: "localhost", port: 5432 },
    cache: { enabled: true, ttl: 3600 }
  };
  return config[key];
}

const dbConfig = getConfig("database");    // { host: string; port: number }
const cacheConfig = getConfig("cache");    // { enabled: boolean; ttl: number }

console.log("✅ 配置访问:", { dbConfig, cacheConfig });

// ============================================================================
// 练习题
// ============================================================================

/**
 * 练习 1：实现类型安全的 pick 函数
 * 
 * 要求：从对象中选择指定的属性
 * 
 * 示例：
 * pick({ name: "Alice", age: 30, city: "NYC" }, ["name", "age"])
 * => { name: "Alice", age: 30 }
 */

// TODO: 实现这个函数
// function pick<T, K extends keyof T>(obj: T, keys: K[]): Pick<T, K> {
//   // 你的代码
// }

/**
 * 练习 2：实现类型安全的 merge 函数
 * 
 * 要求：合并两个对象，第二个对象覆盖第一个
 * 约束：两个对象必须有相同的键
 */

// TODO: 实现这个函数
// function merge<T>(obj1: T, obj2: Partial<T>): T {
//   // 你的代码
// }

/**
 * 练习 3：实现有最小值的数组
 * 
 * 要求：创建一个类，确保数组至少有一个元素
 */

// TODO: 实现这个类
// class NonEmptyArray<T> {
//   constructor(first: T, ...rest: T[]) {
//     // 你的代码
//   }
//   // 添加其他方法
// }

// ============================================================================
// 参考答案
// ============================================================================

// 答案 1
function pick<T, K extends keyof T>(obj: T, keys: K[]): Pick<T, K> {
  const result = {} as Pick<T, K>;
  for (const key of keys) {
    result[key] = obj[key];
  }
  return result;
}

// 答案 2
function merge<T>(obj1: T, obj2: Partial<T>): T {
  return { ...obj1, ...obj2 };
}

// 答案 3
class NonEmptyArray<T> {
  private items: T[];

  constructor(first: T, ...rest: T[]) {
    this.items = [first, ...rest];
  }

  get first(): T {
    return this.items[0];
  }

  get last(): T {
    return this.items[this.items.length - 1];
  }

  push(item: T): void {
    this.items.push(item);
  }

  toArray(): T[] {
    return [...this.items];
  }
}

// 测试答案
console.log("\n===== 练习答案 =====");

const obj = { name: "Alice", age: 30, city: "NYC" };
console.log("练习1:", pick(obj, ["name", "age"]));

const merged = merge({ x: 1, y: 2 }, { y: 3 });
console.log("练习2:", merged);

const nonEmpty = new NonEmptyArray(1, 2, 3);
console.log("练习3:", nonEmpty.toArray());

// ============================================================================
// 关键要点总结
// ============================================================================

/**
 * 1. 使用 extends 约束泛型类型
 * 2. keyof 约束确保键的类型安全
 * 3. 多重约束使用 & 连接
 * 4. 约束让泛型更安全，同时保持灵活性
 * 5. 约束在编译时检查，运行时无成本
 * 
 * 下一步：学习类型推断 (03-type-inference.ts)
 */
