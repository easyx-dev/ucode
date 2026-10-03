/** /api/v1/mcp：用户级 MCP 服务器配置的增删改，落 `$APP_HOME/agent/mcp.json` */
import {
  type McpDeleteResponse,
  type McpListResponse,
  type McpUpsertInput,
  type McpWriteResponse,
  mcpDeleteInputSchema,
  mcpListInputSchema,
  mcpUpsertInputSchema,
} from "@ucode/contracts";
import { Hono } from "hono";

import { deleteMcpServer, readMcpConfig, writeMcpServer } from "../../agent/mcp";
import { ok } from "../../lib/response";
import { jsonBody } from "../../lib/validate";

export const createMcpRoute = () => {
  const router = new Hono();

  router.post("/list", jsonBody(mcpListInputSchema), (c) => {
    const response: McpListResponse = readMcpConfig();
    return c.json(ok(response));
  });

  router.post("/upsert", jsonBody(mcpUpsertInputSchema), (c) => {
    const response: McpWriteResponse = writeMcpServer(c.req.valid("json") as McpUpsertInput);
    return c.json(ok(response));
  });

  router.post("/delete", jsonBody(mcpDeleteInputSchema), (c) => {
    const response: McpDeleteResponse = deleteMcpServer(c.req.valid("json").name);
    return c.json(ok(response));
  });

  return router;
};
