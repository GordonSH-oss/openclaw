/**
 * 06 - 高级条件类型
 * 学习目标：复杂的条件类型应用
 */

// 分布式条件类型
type ToArray<T> = T extends any ? T[] : never;
type StrOrNumArray = ToArray<string | number>;  // string[] | number[]

// 递归条件类型
type DeepReadonly<T> = T extends object
  ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
  : T;

type User = {
  name: string;
  address: {
    city: string;
  };
};

type ReadonlyUser = DeepReadonly<User>;

console.log("✅ 高级条件类型完成");
