/**
 * `@ucode/sdk/http` —— HTTP + SSE 传输的入口（浏览器与终端共用；只用 fetch，不依赖 EventSource）。
 */

export type { HttpClientOptions as ClientOptions } from "@ucode/binding-http/client";
export { createHttpClient as createClient } from "@ucode/binding-http/client";
