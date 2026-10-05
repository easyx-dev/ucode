/** @ucode/contracts：接口契约的单一事实源，server 与 web 共用 */

// 接口文档生成器复用契约包同一实例的 zod 把请求 schema 转 JSON Schema，避免与根依赖解析出两份
export { toJSONSchema } from "zod";
export * from "./agents/input";
export * from "./agents/output";
export * from "./attachments/output";
export * from "./auth/input";
export * from "./auth/output";
export * from "./commands/input";
export * from "./commands/output";
export * from "./common";
export * from "./config/input";
export * from "./config/output";
export * from "./constants";
export * from "./envelope";
export * from "./events";
export * from "./fs/input";
export * from "./fs/output";
export * from "./goals/input";
export * from "./goals/output";
export * from "./health/output";
export * from "./interactions/input";
export * from "./interactions/output";
export * from "./locale";
export * from "./mcp/input";
export * from "./mcp/output";
export * from "./messages/input";
export * from "./messages/output";
export * from "./models/output";
export * from "./runtime";
export * from "./service/input";
export * from "./service/output";
export * from "./sessions/input";
export * from "./sessions/output";
export * from "./stats/input";
export * from "./stats/output";
