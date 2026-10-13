/** /api/v1/projects：项目列表、改名与重排（模型 / 档位 / 模式由会话里的选择写回，不走这里） */
import {
  emptyInputSchema,
  type ProjectListResponse,
  type ProjectReorderInput,
  type ProjectSummary,
  type ProjectUpdateInput,
  projectReorderInputSchema,
  projectUpdateInputSchema,
} from "@ucode/contracts";
import { Hono } from "hono";
import { ok } from "../../platform/response";
import { jsonBody } from "../../platform/validate";
import type { Services } from "../../services";

/** 列表响应；与写入后广播的帧同形，客户端只在一处归并 */
const projectListOf = (projects: ProjectSummary[]): ProjectListResponse => ({
  projects,
  total: projects.length,
});

const projectList = (services: Services): ProjectListResponse =>
  projectListOf(services.projects.list());

export const createProjectsRoute = (services: Services) => {
  const router = new Hono();

  router.post("/list", jsonBody(emptyInputSchema), (c) => c.json(ok(projectList(services))));
  router.post("/update", jsonBody(projectUpdateInputSchema), (c) => {
    const input = c.req.valid("json") satisfies ProjectUpdateInput;
    // 广播在服务层统一做（改名与写回默认值都会发），这里只回响应
    const project: ProjectSummary = services.projects.rename(input.path, input.name);
    return c.json(ok(project));
  });
  router.post("/reorder", jsonBody(projectReorderInputSchema), (c) => {
    const input = c.req.valid("json") satisfies ProjectReorderInput;
    return c.json(ok(projectListOf(services.projects.reorder(input.paths))));
  });

  return router;
};
