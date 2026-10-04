/**
 * 生成 `docs/api-reference.md`：请求参数取自 zod（`z.toJSONSchema`），响应结构取自 TS 类型。
 *
 * 入口：`pnpm api:docs`；`scripts/verify/checks/api-docs.ts` 会在 `pnpm check` 时重跑并比对，防止文档漂移。
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import * as contracts from "../../packages/contracts/src/index.ts";
import { collectFieldDocs, createContractProgram, typeToDocNode } from "./contract-types.ts";
import { API_ENDPOINTS, type ApiEndpoint } from "./endpoints.ts";
import { createRefRegistry, renderNodeTables, renderTables } from "./render.ts";
import { jsonSchemaToDocNode } from "./schema-params.ts";

/** 域的中文标题 */
const DOMAIN_LABELS: Record<string, string> = {
  health: "健康检查",
  models: "模型目录",
  config: "配置",
  sessions: "会话",
  messages: "消息",
  events: "事件流",
  interactions: "交互请求",
  fs: "文件系统",
  mcp: "MCP 服务器",
  goals: "目标模式",
  stats: "使用统计",
};

const schemas = contracts as unknown as Record<string, unknown>;

const fullPath = (endpoint: ApiEndpoint): string =>
  `${contracts.API_BASE_PATH}/${endpoint.domain}${endpoint.action ? `/${endpoint.action}` : ""}`;

const jsonSchemaOf = (schemaName: string): Record<string, unknown> => {
  const schema = schemas[schemaName];
  if (!schema) throw new Error(`契约里找不到请求 schema：${schemaName}`);
  // 用契约包同一实例的 zod：避免根依赖与契约依赖解析成两份 zod 导致 toJSONSchema 不识别 schema
  return contracts.toJSONSchema(schema as Parameters<typeof contracts.toJSONSchema>[0], {
    io: "input",
  }) as Record<string, unknown>;
};

/** 单个端点小节 */
const renderEndpoint = (
  endpoint: ApiEndpoint,
  ctx: ReturnType<typeof createContractProgram>,
  refs: ReturnType<typeof createRefRegistry>,
): string => {
  const blocks: string[] = [
    `### ${endpoint.method} ${fullPath(endpoint)}`,
    "",
    endpoint.summary,
    "",
  ];

  blocks.push("**请求参数**", "");
  const jsonSchema = endpoint.input ? jsonSchemaOf(endpoint.input) : null;
  const properties = jsonSchema?.properties;
  const hasParams =
    jsonSchema !== null &&
    (jsonSchema.type !== "object" || (properties && Object.keys(properties).length > 0));
  if (hasParams && endpoint.requestType && jsonSchema) {
    const docs = collectFieldDocs(ctx, endpoint.requestType);
    const node = jsonSchemaToDocNode(jsonSchema, docs);
    blocks.push(renderTables(renderNodeTables(node, refs), "request"), "");
  } else {
    blocks.push("无参数（body 传 `{}`）", "");
  }

  if (endpoint.stream) {
    blocks.push(
      "**响应**",
      "",
      "SSE 事件流（`text/event-stream`），不套封套；帧结构与事件名见「事件流」。",
      "",
    );
  } else {
    blocks.push(`**响应类型**：\`${endpoint.output}\``, "");
    const tables = renderNodeTables(typeToDocNode(ctx, endpoint.output), refs);
    blocks.push(renderTables(tables, "response"), "");
  }

  return blocks.join("\n");
};

/** 事件流（SSE）小节：直接用契约里的帧类型与事件名 */
const renderEventsSection = (
  ctx: ReturnType<typeof createContractProgram>,
  refs: ReturnType<typeof createRefRegistry>,
): string => {
  const lines: string[] = [
    "## 事件流",
    "",
    "`POST /api/v1/events` 返回 `text/event-stream`，**不套封套**：SSE 事件名固定 `message`，",
    "真正的类型在 `data` 的 JSON 里。心跳为 `: heartbeat` 注释行；订阅者队列满时服务端直接断流，",
    "由客户端重连 + `messages/list` 快照补齐。",
    "",
    "**事件帧结构**",
    "",
    renderTables(renderNodeTables(typeToDocNode(ctx, "ServerEventPayload"), refs), "response"),
    "",
    "**控制帧结构**",
    "",
    renderTables(renderNodeTables(typeToDocNode(ctx, "ServerControlEvent"), refs), "response"),
    "",
    "**事件名（`type`）**",
    "",
  ];
  for (const name of contracts.EVENT_NAMES) lines.push(`- \`${name}\``);
  lines.push("");
  lines.push("各事件 `data` 的载荷说明见 [README「全局事件流」](../README.md#全局事件流)。", "");
  return lines.join("\n");
};

/** 生成完整文档 */
export const buildApiDoc = (): string => {
  const ctx = createContractProgram();
  const refs = createRefRegistry();
  const lines: string[] = [
    "# 接口参考",
    "",
    "> 本文件由 `pnpm api:docs` 从 `packages/contracts/` 生成，**请勿手改**；`pnpm check` 会校验它与契约一致。",
    "> 传输约定、封套、错误码、字段命名等通用规范见 [接口规范](./api.md)。",
    "",
    "## 约定速览",
    "",
    `- 前缀 \`${contracts.API_BASE_PATH}\`；除 \`GET /api/v1/health\` 外一律 \`POST\` + JSON body，无参数接口也要发 \`{}\``,
    '- 非流式响应共用封套：成功 `{ success: true, code: "ok", message: "", data }`；失败 `{ success, code, message, data, params? }`',
    "- 字段一律 camelCase；请求里指向资源的 id 用 `<资源>Id`，响应里资源自身用 `id`",
    "- 类型文本中的链接指向文末「公共类型」；`（…）` 内为该字段的取值约束",
    "",
    "## 接口一览",
    "",
    "| 方法 | 路径 | 说明 |",
    "| --- | --- | --- |",
  ];
  for (const endpoint of API_ENDPOINTS) {
    lines.push(`| ${endpoint.method} | \`${fullPath(endpoint)}\` | ${endpoint.summary} |`);
  }
  lines.push("");

  let currentDomain = "";
  for (const endpoint of API_ENDPOINTS) {
    if (endpoint.domain !== currentDomain) {
      currentDomain = endpoint.domain;
      // 事件流单独成节，这里不重复开域标题
      if (!endpoint.stream) {
        lines.push(
          `## ${DOMAIN_LABELS[endpoint.domain] ?? endpoint.domain}（\`${endpoint.domain}\`）`,
          "",
        );
      }
    }
    if (endpoint.stream) continue;
    lines.push(renderEndpoint(endpoint, ctx, refs), "");
  }

  lines.push(renderEventsSection(ctx, refs), "");

  // 附录：按首次出现顺序展开所有具名引用
  const appendix: string[] = ["## 公共类型", "", "以下类型被多个接口复用，字段说明同响应表。", ""];
  for (let index = 0; index < refs.names.length; index += 1) {
    const name = refs.names[index];
    if (!name) continue;
    const tables = renderNodeTables(typeToDocNode(ctx, name), refs);
    appendix.push(`### ${name}`, "", renderTables(tables, "response"), "");
  }
  lines.push(...appendix);

  return `${lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd()}\n`;
};

/** 生成并写入 `docs/api-reference.md` */
export const generateApiDoc = (): string => {
  const outputPath = resolve(import.meta.dirname, "../../docs/api-reference.md");
  const content = buildApiDoc();
  writeFileSync(outputPath, content, "utf8");
  return outputPath;
};

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename);
if (isMain) {
  const outputPath = generateApiDoc();
  console.log(`已生成 ${outputPath}`);
}
