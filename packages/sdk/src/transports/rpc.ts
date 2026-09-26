/**
 * `@ucode/sdk/rpc` —— unix socket / TCP 传输的入口（4 字节长度前缀）。
 */

export type { RpcClientOptions as ClientOptions } from "@ucode/binding-rpc/client";
export { createRpcClient as createClient } from "@ucode/binding-rpc/client";
