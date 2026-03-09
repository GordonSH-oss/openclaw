/**
 * 01 - 基础泛型（Generics）
 * 
 * 学习目标：
 * 1. 理解泛型的基本概念
 * 2. 学会编写泛型函数
 * 3. 掌握泛型类的使用
 * 4. 理解类型推断
 * 
 * 预计时间：10 分钟
 */

// ============================================================================
// 1. 什么是泛型？
// ============================================================================

// 问题：没有泛型的情况
function identityNumber(value: number): number {
  return value;
}

function identityString(value: string): string {
  return value;
}

// 这样需要为每种类型写一个函数，太麻烦了！

// 解决方案：使用泛型
// T 是类型参数，可以是任何类型
function identity<T>(value: T): T {
  return value;
}

// 使用时 TypeScript 会自动推断类型
const num = identity(42);        // num 的类型是 number
const str = identity("hello");   // str 的类型是 string
const bool = identity(true);     // bool 的类型是 boolean

console.log("✅ 基础泛型函数:", { num, str, bool });

// ============================================================================
// 2. 泛型数组
// ============================================================================

// 获取数组的第一个元素
function first<T>(arr: T[]): T | undefined {
  return arr[0];
}

const numbers = [1, 2, 3, 4, 5];
const firstNum = first(numbers);  // number | undefined

const words = ["hello", "world"];
const firstWord = first(words);   // string | undefined

console.log("✅ 泛型数组函数:", { firstNum, firstWord });

// ============================================================================
// 3. 泛型类
// ============================================================================

// 泛型栈实现
class Stack<T> {
  private items: T[] = [];

  push(item: T): void {
    this.items.push(item);
  }

  pop(): T | undefined {
    return this.items.pop();
  }

  peek(): T | undefined {
    return this.items[this.items.length - 1];
  }

  get size(): number {
    return this.items.length;
  }

  isEmpty(): boolean {
    return this.items.length === 0;
  }
}

// 使用泛型栈
const numberStack = new Stack<number>();
numberStack.push(1);
numberStack.push(2);
numberStack.push(3);
console.log("✅ 数字栈:", numberStack.pop()); // 3

const stringStack = new Stack<string>();
stringStack.push("a");
stringStack.push("b");
console.log("✅ 字符串栈:", stringStack.pop()); // "b"

// ============================================================================
// 4. 多个类型参数
// ============================================================================

// 键值对类
class Pair<K, V> {
  constructor(
    public key: K,
    public value: V
  ) {}

  display(): string {
    return `${this.key}: ${this.value}`;
  }
}

const pair1 = new Pair<string, number>("age", 25);
const pair2 = new Pair<number, string>(1, "first");
const pair3 = new Pair("name", "Alice"); // 类型推断

console.log("✅ 键值对:", pair1.display(), pair2.display(), pair3.display());

// ============================================================================
// 5. 泛型接口
// ============================================================================

// 泛型接口定义
interface Box<T> {
  value: T;
  getValue(): T;
  setValue(value: T): void;
}

// 实现泛型接口
class SimpleBox<T> implements Box<T> {
  constructor(public value: T) {}

  getValue(): T {
    return this.value;
  }

  setValue(value: T): void {
    this.value = value;
  }
}

const numberBox = new SimpleBox<number>(42);
console.log("✅ 盒子值:", numberBox.getValue());

numberBox.setValue(100);
console.log("✅ 更新后的值:", numberBox.getValue());

// ============================================================================
// 6. 泛型与数组方法
// ============================================================================

// 自定义 map 函数
function map<T, U>(arr: T[], fn: (item: T) => U): U[] {
  const result: U[] = [];
  for (const item of arr) {
    result.push(fn(item));
  }
  return result;
}

const nums = [1, 2, 3, 4, 5];
const doubled = map(nums, (n) => n * 2);         // number[]
const strings = map(nums, (n) => `#${n}`);       // string[]

console.log("✅ 自定义 map:", { doubled, strings });

// ============================================================================
// 7. 为什么需要泛型？
// ============================================================================

// ❌ 不使用泛型：类型信息丢失
function wrapInArrayAny(value: any): any[] {
  return [value];
}

const wrappedAny = wrapInArrayAny(42);
// wrappedAny 的类型是 any[]，我们失去了 42 是 number 的信息
// wrappedAny[0].toFixed(); // 运行时没问题，但类型检查不到

// ✅ 使用泛型：保留类型信息
function wrapInArray<T>(value: T): T[] {
  return [value];
}

const wrapped = wrapInArray(42);
// wrapped 的类型是 number[]，类型信息被保留
console.log("✅ 包装在数组中:", wrapped[0].toFixed(2));

// ============================================================================
// 练习题
// ============================================================================

/**
 * 练习 1：实现泛型 swap 函数
 * 
 * 要求：编写一个函数，交换元组中的两个元素
 * 
 * 示例：
 * swap([1, "hello"]) => ["hello", 1]
 */

// TODO: 实现这个函数
// function swap<T, U>(tuple: [T, U]): [U, T] {
//   // 你的代码
// }

// 测试
// const swapped = swap([42, "answer"]);
// console.log("练习1:", swapped); // ["answer", 42]

/**
 * 练习 2：实现泛型 Queue 类
 * 
 * 要求：实现一个队列（先进先出）
 * 方法：enqueue(item), dequeue(), peek(), isEmpty()
 */

// TODO: 实现这个类
// class Queue<T> {
//   // 你的代码
// }

// 测试
// const queue = new Queue<number>();
// queue.enqueue(1);
// queue.enqueue(2);
// queue.enqueue(3);
// console.log("练习2:", queue.dequeue()); // 1

/**
 * 练习 3：实现泛型 filter 函数
 * 
 * 要求：过滤数组中的元素
 * 
 * 示例：
 * filter([1, 2, 3, 4, 5], x => x > 2) => [3, 4, 5]
 */

// TODO: 实现这个函数
// function filter<T>(arr: T[], predicate: (item: T) => boolean): T[] {
//   // 你的代码
// }

// 测试
// const filtered = filter([1, 2, 3, 4, 5], x => x % 2 === 0);
// console.log("练习3:", filtered); // [2, 4]

// ============================================================================
// 参考答案（尝试自己实现后再查看）
// ============================================================================

// 答案 1
function swap<T, U>(tuple: [T, U]): [U, T] {
  return [tuple[1], tuple[0]];
}

// 答案 2
class Queue<T> {
  private items: T[] = [];

  enqueue(item: T): void {
    this.items.push(item);
  }

  dequeue(): T | undefined {
    return this.items.shift();
  }

  peek(): T | undefined {
    return this.items[0];
  }

  isEmpty(): boolean {
    return this.items.length === 0;
  }
}

// 答案 3
function filter<T>(arr: T[], predicate: (item: T) => boolean): T[] {
  const result: T[] = [];
  for (const item of arr) {
    if (predicate(item)) {
      result.push(item);
    }
  }
  return result;
}

// 测试答案
console.log("\n===== 练习答案 =====");
console.log("练习1:", swap([42, "answer"]));

const testQueue = new Queue<number>();
testQueue.enqueue(1);
testQueue.enqueue(2);
testQueue.enqueue(3);
console.log("练习2:", testQueue.dequeue());

console.log("练习3:", filter([1, 2, 3, 4, 5], x => x % 2 === 0));

// ============================================================================
// 关键要点总结
// ============================================================================

/**
 * 1. 泛型让代码可以适用于多种类型，同时保持类型安全
 * 2. 使用 <T> 定义类型参数，T 可以是任何标识符
 * 3. TypeScript 通常能自动推断泛型类型
 * 4. 泛型可以用于函数、类、接口
 * 5. 可以有多个类型参数：<T, U, V>
 * 
 * 下一步：学习泛型约束 (02-generic-constraints.ts)
 */
