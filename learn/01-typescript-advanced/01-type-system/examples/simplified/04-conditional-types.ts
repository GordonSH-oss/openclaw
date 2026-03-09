/**
 * 04 - 条件类型（Conditional Types）
 * 学习目标：理解 T extends U ? X : Y 语法
 */

// 基础条件类型
type IsString<T> = T extends string ? true : false;

type A = IsString<"hello">;  // true
type B = IsString<number>;   // false

console.log("✅ 条件类型基础");

// 实用例子：NonNullable
type MyNonNullable<T> = T extends null | undefined ? never : T;

type C = MyNonNullable<string | null>;  // string
type D = MyNonNullable<number | undefined>;  // number

// 练习：实现 Exclude 工具类型
type MyExclude<T, U> = T extends U ? never : T;
type E = MyExclude<"a" | "b" | "c", "a">;  // "b" | "c"

console.log("✅ 条件类型练习完成");
