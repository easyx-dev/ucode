/** 使用统计接口的请求 zod 模型 */
import { z } from "zod";

/**
 * 全局统计的时间范围：不传表示全部时间，传正整数表示最近 N 天。
 * 上限只防明显的误传（如天数写成时间戳），不限制正常范围查询。
 */
export const statsSummaryInputSchema = z.object({
  days: z.number().int().positive().max(3650).optional(),
});

export type StatsSummaryRequest = z.input<typeof statsSummaryInputSchema>;
export type StatsSummaryInput = z.infer<typeof statsSummaryInputSchema>;
