/** 运行时 SDK 的取值入口：hooks 通过它拿到客户端、事件流与会话流 store */
import { getRuntime } from "../runtime";

export const sdk = {
  get client() {
    return getRuntime().sdk.client;
  },
  get events() {
    return getRuntime().sdk.events;
  },
  get sessionStream() {
    return getRuntime().sdk.sessionStream;
  },
};
