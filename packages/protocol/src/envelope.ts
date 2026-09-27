import type { z } from "zod";
import { ClientChannelMessageSchema, ServerChannelMessageSchema } from "./channels.ts";
import { CommandEnvelopeSchema } from "./commands.ts";
import { EventSchema } from "./events.ts";
import { HelloSchema, RejectedSchema, WelcomeSchema } from "./handshake.ts";
import { ResponseSchema } from "./responses.ts";
import { UiResponseSchema, UiServerMessageSchema } from "./ui.ts";

/**
 * 线路信封：一条连接上往来的两类消息。
 *
 * 分方向定义（客户端 → 服务层 / 服务层 → 客户端），因为**交互面方向相反**：
 * ui.request 由服务层发起，ui.response 由控制层回。方向搞错会死锁，所以在类型上就分开。
 */
export const ClientMessageSchema = [
  HelloSchema,
  CommandEnvelopeSchema,
  UiResponseSchema,
  ...ClientChannelMessageSchema.options,
] as const;

export const ServerMessageSchema = [
  WelcomeSchema,
  RejectedSchema,
  ResponseSchema,
  ...EventSchema.options,
  ...UiServerMessageSchema.options,
  ...ServerChannelMessageSchema.options,
] as const;

export type ClientMessage = z.infer<(typeof ClientMessageSchema)[number]>;
export type ServerMessage = z.infer<(typeof ServerMessageSchema)[number]>;

/** 解析结果：失败必须可被识别，且要能区分"不是 JSON"与"是 JSON 但不符合协议"。 */
export type ParseResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      error: { code: "invalid_json" | "invalid_message"; message: string; issues?: unknown };
    };

function toObject(raw: unknown): unknown {
  return raw;
}

export function parseWireText(text: string): ParseResult<unknown> {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch (error) {
    return {
      ok: false,
      error: {
        code: "invalid_json",
        message: error instanceof Error ? error.message : "消息不是合法 JSON。",
      },
    };
  }
}

function parseAgainst<T>(schemas: readonly z.ZodType[], raw: unknown): ParseResult<T> {
  const value = toObject(raw);
  const issues: unknown[] = [];
  for (const schema of schemas) {
    const result = schema.safeParse(value);
    if (result.success) return { ok: true, value: result.data as T };
    issues.push(...result.error.issues);
  }
  const type =
    typeof value === "object" && value !== null && "type" in value
      ? String((value as { type: unknown }).type)
      : "(无 type 字段)";
  return {
    ok: false,
    error: {
      code: "invalid_message",
      message: `不是合法的协议 C 消息：type=${type}`,
      issues,
    },
  };
}

export function parseClientMessage(raw: unknown): ParseResult<ClientMessage> {
  return parseAgainst<ClientMessage>(ClientMessageSchema, raw);
}

export function parseServerMessage(raw: unknown): ParseResult<ServerMessage> {
  return parseAgainst<ServerMessage>(ServerMessageSchema, raw);
}
