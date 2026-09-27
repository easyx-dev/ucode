import type { Transport } from "@ucode/protocol";
import type { NodeRecord } from "./nodes.ts";
import { createClient as createHttpClient } from "./transports/http.ts";
import { createClient as createRpcClient } from "./transports/rpc.ts";

/**
 * 节点传输工厂（F-6.3）——**单独一个入口**，因为它会引入传输实现（含 node:net / Buffer）。
 *
 * 节点注册表本身是纯数据（浏览器也能用），而"真正去连一个节点"必须有传输实现。
 * 把两者分开，控制层不连节点时（比如 Web 壳只连本机服务层）就不会把 node 专有代码
 * 带进类型解析与打包结果——这与 sdk 传输做成子路径是同一个理由。
 */

/** 按端点造传输（控制层接入节点只需要它——不去 core、不引入绑定实现）。 */
export function transportForNode(
  node: NodeRecord,
  /** 客户端标识（服务层用它区分附件）；省略时按节点名派生一个稳定的。 */
  clientId = `sdk-node-${node.name}`,
): Transport {
  if (node.endpoint.kind === "http") {
    return createHttpClient({ baseUrl: node.endpoint.baseUrl, clientId });
  }
  return createRpcClient({
    ...(node.endpoint.socketPath === undefined ? {} : { socketPath: node.endpoint.socketPath }),
    ...(node.endpoint.host === undefined ? {} : { host: node.endpoint.host }),
    ...(node.endpoint.port === undefined ? {} : { port: node.endpoint.port }),
  });
}
