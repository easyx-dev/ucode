/**
 * Common catalog (English): surface-agnostic protocol / client prompts.
 *
 * Keys are the Simplified-Chinese source strings (see `zh-CN.ts`); key sets must stay
 * identical — `scripts/verify` fails on drift.
 */
export default {
  "响应.非JSON": "Server returned a non-JSON response (HTTP {{status}})",
  请求失败: "Request failed (HTTP {{status}})",
  事件流失败: "Event stream failed (HTTP {{status}})",
  服务未返回流: "The server did not return a stream",
};
