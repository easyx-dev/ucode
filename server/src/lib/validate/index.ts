/** POST + JSON 请求体校验的薄封装 */
import { zValidator } from "@hono/zod-validator";
import { ERROR_CODES } from "@ucode/contracts";
import type { ZodType } from "zod";

import { fail } from "../response";

/** POST + JSON 请求体校验，校验失败统一返回 400。 */
export function jsonBody<S extends ZodType>(schema: S) {
  return zValidator("json", schema, (result, c) => {
    if (!result.success) {
      return c.json(fail(ERROR_CODES.invalidRequest, "请求参数校验失败", result.error.issues), 400);
    }
    return undefined;
  });
}
