/** terminal 域的请求 zod 模型：创建、列出、改尺寸、关闭，以及输出流的握手参数 */
import { z } from "zod";

import {
  TERMINAL_COLS_MAX,
  TERMINAL_COLS_MIN,
  TERMINAL_ROWS_MAX,
  TERMINAL_ROWS_MIN,
} from "../constants";

/**
 * 终端归属：`sessionId` 让服务端按该会话解析工作目录（未绑定目录的会话用它的工作区），
 * 草稿态这类还没有会话的场合给 `cwd`。终端按解析出的目录归口，两者都缺时落服务的工作区根。
 */
const terminalTargetShape = {
  sessionId: z.string().min(1).optional(),
  cwd: z.string().min(1).optional(),
};

const terminalSizeShape = {
  cols: z.number().int().min(TERMINAL_COLS_MIN).max(TERMINAL_COLS_MAX),
  rows: z.number().int().min(TERMINAL_ROWS_MIN).max(TERMINAL_ROWS_MAX),
};

const terminalIdShape = { terminalId: z.string().min(1) };

/** 起一个终端；尺寸只是初值，面板挂载后按实测值再改一次 */
export const terminalCreateInputSchema = z.object({
  ...terminalTargetShape,
  ...terminalSizeShape,
});

/** 列出某个目标下仍在的终端（客户端按它恢复标签） */
export const terminalListInputSchema = z.object(terminalTargetShape);

/** 改尺寸：面板实测后上报（容器变化、字号变化都要走一次） */
export const terminalResizeInputSchema = z.object({
  ...terminalIdShape,
  ...terminalSizeShape,
});

export const terminalCloseInputSchema = z.object(terminalIdShape);

/** 签一张输出流的握手票：票据是一次性的，见 `terminalStreamQuerySchema` */
export const terminalTicketInputSchema = z.object(terminalIdShape);

/**
 * 输出流的握手参数（query）。握手校验的是这张一次性票而不是长期凭证：
 * 浏览器的 WebSocket API 不能带 `Authorization` 头，凭证又不走 Cookie（见鉴权约定）。
 */
export const terminalStreamQuerySchema = z.object({
  terminalId: z.string().min(1),
  ticket: z.string().min(1),
});

export type TerminalCreateInput = z.infer<typeof terminalCreateInputSchema>;
export type TerminalCreateRequest = z.input<typeof terminalCreateInputSchema>;
export type TerminalListInput = z.infer<typeof terminalListInputSchema>;
export type TerminalListRequest = z.input<typeof terminalListInputSchema>;
export type TerminalResizeInput = z.infer<typeof terminalResizeInputSchema>;
export type TerminalResizeRequest = z.input<typeof terminalResizeInputSchema>;
export type TerminalCloseInput = z.infer<typeof terminalCloseInputSchema>;
export type TerminalCloseRequest = z.input<typeof terminalCloseInputSchema>;
export type TerminalTicketInput = z.infer<typeof terminalTicketInputSchema>;
export type TerminalTicketRequest = z.input<typeof terminalTicketInputSchema>;
export type TerminalStreamQuery = z.infer<typeof terminalStreamQuerySchema>;
