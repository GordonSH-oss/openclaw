/**
 * 05 - infer 关键字
 * 学习目标：使用 infer 提取类型
 */

// 提取函数返回类型
type MyReturnType<T> = T extends (...args: any[]) => infer R ? R : never;

function add(a: number, b: number): number {
  return a + b;
}

type AddReturn = MyReturnType<typeof add>;  // number

// 提取数组元素类型
type ArrayElement<T> = T extends (infer E)[] ? E : never;

type Nums = ArrayElement<number[]>;  // number
type Strs = ArrayElement<string[]>;  // string

// 提取 Promise 值类型
type Unwrap<T> = T extends Promise<infer U> ? U : T;

type X = Unwrap<Promise<string>>;  // string
type Y = Unwrap<number>;  // number

console.log("✅ infer 关键字练习完成");
