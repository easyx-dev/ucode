/** POST + JSON 请求体校验的薄封装 */
import { zValidator } from "@hono/zod-validator";
import type { ZodType } from "zod";

import { fail } from "./result";

/** POST + JSON 请求体校验，校验失败统一返回 400。 */
export function jsonBody<S extends ZodType>(schema: S) {
  return zValidator("json", schema, (result, c) => {
    if (!result.success) {
      return c.json(fail("invalid_request", "请求参数校验失败", result.error.issues), 400);
    }
    return undefined;
  });
}
