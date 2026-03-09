function first(arr) {
    return arr[0];
}
var numbers = [1, 2, 3, 4, 5];
var firstNum = first(numbers); // number | undefined
var words = ["hello", "world"];
var firstWord = first(words); // string | undefined
console.log("✅ 泛型数组函数:", { firstNum: firstNum, firstWord: firstWord });
