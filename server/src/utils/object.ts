/** 纯函数工具：对象取值。数组不算 record——`typeof []` 也是 `object`，不排除会让调用方误判 */
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
