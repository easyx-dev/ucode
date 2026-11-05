/** /api/v1/memory：项目级记忆的浏览与维护（改 / 删已有条目；新增走 remember 工具与自动回顾） */
import {
  emptyInputSchema,
  type MemoryDeleteInput,
  type MemoryDeleteResponse,
  type MemoryFactView,
  type MemoryListResponse,
  type MemoryReadInput,
  type MemoryUpdateInput,
  memoryDeleteInputSchema,
  memoryReadInputSchema,
  memoryUpdateInputSchema,
} from "@ucode/contracts";
import { Hono } from "hono";
import { ok } from "../../platform/response";
import { jsonBody } from "../../platform/validate";
import type { Services } from "../../services";

export const createMemoryRoute = (services: Services) => {
  const router = new Hono();

  router.post("/list", jsonBody(emptyInputSchema), (c) => {
    const projects = services.memory.list();
    return c.json(ok({ projects, total: projects.length } satisfies MemoryListResponse));
  });

  // 读一条记忆的正文：按「记忆目录名 + 事实文件名」寻址，两段都只允许单段名字
  router.post("/read", jsonBody(memoryReadInputSchema), (c) => {
    const input = c.req.valid("json") satisfies MemoryReadInput;
    return c.json(ok(services.memory.read(input.dir, input.file) satisfies MemoryFactView));
  });

  // 改一条记忆：标题与正文整体替换，文件名不变（它是记忆回顾记录的凭据）
  router.post("/update", jsonBody(memoryUpdateInputSchema), (c) => {
    const input = c.req.valid("json") satisfies MemoryUpdateInput;
    const fact = services.memory.update(input.dir, input.file, {
      title: input.title,
      content: input.content,
    });
    return c.json(ok(fact satisfies MemoryFactView));
  });

  // 删一条记忆：文件与索引行一起删；已不存在时 removed 为 false
  router.post("/delete", jsonBody(memoryDeleteInputSchema), (c) => {
    const input = c.req.valid("json") satisfies MemoryDeleteInput;
    return c.json(ok(services.memory.remove(input.dir, input.file) satisfies MemoryDeleteResponse));
  });

  return router;
};
