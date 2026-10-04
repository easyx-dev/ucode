/** 全局事件流：SDK 连接实例（应用级单例）；React 侧只订阅，不关心连接细节 */
import { sdk } from "@/lib/sdk";

export const eventStream = sdk.events;
