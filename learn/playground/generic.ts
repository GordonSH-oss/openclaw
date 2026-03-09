function first<T>(arr: T[]): T | undefined {
    return arr[0];
  }
  
  const numbers = [1, 2, 3, 4, 5];
  const firstNum = first(numbers);  // number | undefined
  
  const words = ["hello", "world"];
  const firstWord = first(words);   // string | undefined
  
  console.log("✅ 泛型数组函数:", { firstNum, firstWord });
