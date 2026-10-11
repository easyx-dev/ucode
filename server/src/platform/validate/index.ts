/** POST + JSON 请求体校验的薄封装 */
import { zValidator } from "@hono/zod-validator";
import { ERROR_CODES } from "@ucode/contracts";
import type { ZodType } from "zod";

import { AppError } from "../response";

/** POST + JSON 请求体校验，校验失败统一抛 400 的 AppError */
export const jsonBody = <S extends ZodType>(schema: S) =>
  zValidator("json", schema, (result) => {
    if (!result.success) {
      throw new AppError(ERROR_CODES.invalidRequest, "请求参数校验失败", 400, result.error.issues);
    }
    return undefined;
  });
