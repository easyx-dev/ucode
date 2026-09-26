/**
 * `@ucode/sdk/stdio` —— stdio 传输的入口（JSONL 按字节切分）。
 * 桌面壳与 TUI 用它：自己 spawn 一个核心层进程，然后说协议。
 */

export type { StdioClientOptions as ClientOptions } from "@ucode/binding-stdio/client";
export { createStdioClient as createClient } from "@ucode/binding-stdio/client";
