/** /api/v1/projects：项目空间的列表 / 登记 / 改名 / 移除 */
import {
  ERROR_CODES,
  emptyInputSchema,
  type Project,
  type ProjectCreateInput,
  type ProjectDeleteResponse,
  type ProjectListResponse,
  type ProjectUpdateInput,
  projectCreateInputSchema,
  projectDeleteInputSchema,
  projectUpdateInputSchema,
} from "@ucode/contracts";
import { Hono } from "hono";

import type { Services } from "../../app";
import type { ProjectRecord } from "../../db/project-repository";
import { AppError, ok } from "../../lib/response";
import { jsonBody } from "../../lib/validate";
import { resolveExistingPath } from "../../utils/path";

const toDTO = (record: ProjectRecord): Project => ({
  id: record.id,
  name: record.name,
  path: record.path,
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
});

/** 登记目录；已在册则幂等返回原项目，重复点选不报错 */
const createProject = (services: Services, input: ProjectCreateInput): Project => {
  const path = resolveExistingPath(input.path);
  const existing = services.projects.findByPath(path);
  return toDTO(existing ?? services.projects.create(path));
};

const findOrThrow = (services: Services, projectId: string): ProjectRecord => {
  const record = services.projects.find(projectId);
  if (!record) {
    throw new AppError(ERROR_CODES.projectNotFound, `项目不存在：${projectId}`, 404, undefined, {
      path: projectId,
    });
  }
  return record;
};

const updateProject = (services: Services, input: ProjectUpdateInput): Project => {
  const record = findOrThrow(services, input.projectId);
  services.projects.rename(input.projectId, input.name);
  return toDTO({ ...record, name: input.name });
};

const deleteProject = (services: Services, projectId: string): ProjectDeleteResponse => {
  findOrThrow(services, projectId);
  services.projects.delete(projectId);
  return { projectId, deleted: true };
};

export const createProjectsRoute = (services: Services) => {
  const router = new Hono();

  router.post("/list", jsonBody(emptyInputSchema), (c) => {
    const projects = services.projects.list().map(toDTO);
    return c.json(ok({ projects, total: projects.length } satisfies ProjectListResponse));
  });

  router.post("/create", jsonBody(projectCreateInputSchema), (c) =>
    c.json(ok(createProject(services, c.req.valid("json")))),
  );

  router.post("/update", jsonBody(projectUpdateInputSchema), (c) =>
    c.json(ok(updateProject(services, c.req.valid("json")))),
  );

  router.post("/delete", jsonBody(projectDeleteInputSchema), (c) =>
    c.json(ok(deleteProject(services, c.req.valid("json").projectId))),
  );

  return router;
};
