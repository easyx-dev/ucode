/**
 * Common catalog (English): surface-agnostic protocol / client prompts.
 *
 * This is the canonical catalog; every key is the Simplified-Chinese copy itself (with
 * `{{placeholders}}`). `zh-CN.ts` is therefore empty; only pure placeholder templates would use
 * a `.`-namespaced summary key. `scripts/verify` fails on drift.
 */
export default {
  "服务返回了非 JSON 响应（HTTP {{status}}）":
    "Server returned a non-JSON response (HTTP {{status}})",
  "请求失败（HTTP {{status}}）": "Request failed (HTTP {{status}})",
  "事件流连接失败（HTTP {{status}}）": "Event stream failed (HTTP {{status}})",
  服务未返回流: "The server did not return a stream",
};
