/**
 * MCP 服务器表单 ↔ 契约入参的转换。
 *
 * 参数、环境变量、请求头在界面上按「一行一条」编辑，落盘前还原成数组 / 对象；
 * 反向转换只用于打开编辑弹窗时回填。
 */
import type { McpExposure, McpServerView, McpTransport, McpUpsertRequest } from "@ucode/contracts";

export type McpFormState = {
  name: string;
  enabled: boolean;
  exposure: McpExposure;
  type: McpTransport;
  /** stdio：启动命令 */
  command: string;
  /** stdio：参数，一行一条 */
  argsText: string;
  /** stdio：环境变量，一行一条 `KEY=VALUE` */
  envText: string;
  /** stdio：工作目录，可空 */
  cwd: string;
  /** http：端点地址 */
  url: string;
  /** http：请求头，一行一条 `KEY=VALUE` */
  headersText: string;
  /** 单请求超时（秒），留空表示用 pi 默认值 */
  timeout: string;
};

/** 服务器名会拼进 `mcp__<server>__<tool>`，与服务端校验保持同一套字符集 */
const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export const emptyMcpForm = (): McpFormState => ({
  name: "",
  enabled: true,
  exposure: "codemode",
  type: "stdio",
  command: "",
  argsText: "",
  envText: "",
  cwd: "",
  url: "",
  headersText: "",
  timeout: "",
});

const toLines = (values: readonly string[] | undefined): string => (values ?? []).join("\n");

const toKeyValueText = (record: Record<string, string> | undefined): string =>
  Object.entries(record ?? {})
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

export const serverToForm = (server: McpServerView): McpFormState =>
  server.type === "stdio"
    ? {
        ...emptyMcpForm(),
        name: server.name,
        enabled: server.enabled,
        exposure: server.exposure,
        type: "stdio",
        command: server.command,
        argsText: toLines(server.args),
        envText: toKeyValueText(server.env),
        cwd: server.cwd ?? "",
        timeout: server.timeout === undefined ? "" : String(server.timeout),
      }
    : {
        ...emptyMcpForm(),
        name: server.name,
        enabled: server.enabled,
        exposure: server.exposure,
        type: "http",
        url: server.url,
        headersText: toKeyValueText(server.headers),
        timeout: server.timeout === undefined ? "" : String(server.timeout),
      };

/** 一行一条：忽略空行与首尾空白 */
const parseLines = (text: string): string[] =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

/** `KEY=VALUE` 按第一个等号拆分；无等号的行按「键 + 空值」处理，不静默丢弃 */
const parseKeyValueText = (text: string): Record<string, string> | undefined => {
  const entries = parseLines(text).map((line): [string, string] => {
    const index = line.indexOf("=");
    return index === -1 ? [line, ""] : [line.slice(0, index).trim(), line.slice(index + 1).trim()];
  });
  const filtered = entries.filter(([key]) => key.length > 0);
  return filtered.length > 0 ? Object.fromEntries(filtered) : undefined;
};

export const isMcpFormValid = (form: McpFormState): boolean => {
  if (!NAME_PATTERN.test(form.name)) return false;
  const timeout = form.timeout.trim();
  if (timeout && (!Number.isInteger(Number(timeout)) || Number(timeout) <= 0)) return false;
  return form.type === "stdio" ? form.command.trim().length > 0 : form.url.trim().length > 0;
};

/** 超时秒数：留空或非法都不提交（服务端 schema 要求正整数） */
const timeoutOf = (form: McpFormState): { timeout?: number } => {
  const value = form.timeout.trim();
  if (!value || !Number.isInteger(Number(value)) || Number(value) <= 0) return {};
  return { timeout: Number(value) };
};

export const formToRequest = (form: McpFormState): McpUpsertRequest => {
  const common = {
    name: form.name,
    enabled: form.enabled,
    exposure: form.exposure,
    ...timeoutOf(form),
  };
  if (form.type === "stdio") {
    const args = parseLines(form.argsText);
    const env = parseKeyValueText(form.envText);
    return {
      ...common,
      type: "stdio",
      command: form.command.trim(),
      ...(args.length > 0 ? { args } : {}),
      ...(env ? { env } : {}),
      ...(form.cwd.trim() ? { cwd: form.cwd.trim() } : {}),
    };
  }
  const headers = parseKeyValueText(form.headersText);
  return {
    ...common,
    type: "http",
    url: form.url.trim(),
    ...(headers ? { headers } : {}),
  };
};
