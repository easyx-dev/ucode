/** 接口客户端的运行时转发：调用点保持 `api.x` 形态，实际取启动时注入的 SDK */
import { type Sdk, SdkError } from "@ucode/sdk";

import { getRuntime } from "../runtime";

type Client = Sdk["client"];

export const api = new Proxy({} as Client, {
  get: (_target, prop) => {
    const client = getRuntime().sdk.client as unknown as Record<string | symbol, unknown>;
    return client[prop];
  },
});

export { describeError } from "../runtime";
export { SdkError as ApiRequestError };
