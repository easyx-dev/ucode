/**
 * /api/v1/design：设计画布的数据面（结构摘要、整页 drawing、选中集、文档级动作）。
 *
 * **一律按会话寻址**：文档按文件路径归口在服务内部（见 `harness/features/design`），
 * 对外只暴露「这个会话当前在改哪份」——路径来自用户打开的那份稿子，客户端不需要传。
 * 唯一带路径的是 `doc open`（用户显式换一份）与 `files`（清单里的一项）。
 *
 * 失败折成 `AppError`：`DesignError` 的 code 决定错误码与状态，`params.ref` 供客户端插值渲染。
 */
import {
  type DesignDocInput,
  type DesignDocResponse,
  type DesignFilesResponse,
  type DesignNodeDetail,
  type DesignRender,
  type DesignSelection,
  type DesignSnapshot,
  designDocInputSchema,
  designFilesInputSchema,
  designNodeInputSchema,
  designRenderInputSchema,
  designSelectInputSchema,
  designSnapshotInputSchema,
  ERROR_CODES,
} from "@ucode/contracts";
import { Hono } from "hono";
import { resolveSessionCwd } from "../../core/session-paths";
import type { DesignTarget } from "../../harness/features/design";
import { isDesignError } from "../../harness/features/design/errors";
import { listProjectDesignFiles } from "../../harness/features/design/paths";
import { AppError, ok } from "../../platform/response";
import { jsonBody } from "../../platform/validate";
import type { Services } from "../../services";

const requireTarget = (services: Services, sessionId: string): DesignTarget => {
  const record = services.sessions.find(sessionId);
  if (!record) {
    throw new AppError(ERROR_CODES.notFound, `会话不存在：${sessionId}`, 404, undefined, {
      path: sessionId,
    });
  }
  return { sessionId, cwd: resolveSessionCwd(record) };
};

/** 设计画的失败折成接口失败：文档缺失是 404，引用失配是 400，落盘失败是 500 */
const toAppError = (error: unknown): AppError => {
  if (error instanceof AppError) return error;
  if (!isDesignError(error)) {
    throw error;
  }
  const params = { ref: error.message };
  if (error.code === "not_found") {
    return new AppError(ERROR_CODES.designNotFound, error.message, 404, undefined, params);
  }
  if (error.code === "anchor_mismatch") {
    return new AppError(ERROR_CODES.designAnchorMismatch, error.message, 400, undefined, params);
  }
  if (error.code === "io_failed") {
    return new AppError(ERROR_CODES.internal, error.message, 500);
  }
  return new AppError(ERROR_CODES.invalidRequest, error.message, 400);
};

export const createDesignRoute = (services: Services) => {
  const router = new Hono();

  router.post("/snapshot", jsonBody(designSnapshotInputSchema), async (c) => {
    const input = c.req.valid("json");
    try {
      const result: DesignSnapshot = await services.design.snapshot({
        ...requireTarget(services, input.sessionId),
        ...(input.pageId === undefined ? {} : { pageId: input.pageId }),
      });
      return c.json(ok(result));
    } catch (error: unknown) {
      throw toAppError(error);
    }
  });

  router.post("/render", jsonBody(designRenderInputSchema), async (c) => {
    const input = c.req.valid("json");
    try {
      const result: DesignRender = await services.design.render({
        ...requireTarget(services, input.sessionId),
        ...(input.pageId === undefined ? {} : { pageId: input.pageId }),
        ...(input.revision === undefined ? {} : { revision: input.revision }),
      });
      return c.json(ok(result));
    } catch (error: unknown) {
      throw toAppError(error);
    }
  });

  router.post("/select", jsonBody(designSelectInputSchema), async (c) => {
    const input = c.req.valid("json");
    try {
      const result: DesignSelection = await services.design.select({
        ...requireTarget(services, input.sessionId),
        ids: input.ids,
      });
      return c.json(ok(result));
    } catch (error: unknown) {
      throw toAppError(error);
    }
  });

  // 设计视图的稿子清单：项目设计稿目录里的 `.design`，标出本会话当前在改的那份
  router.post("/files", jsonBody(designFilesInputSchema), async (c) => {
    const input = c.req.valid("json");
    try {
      const target = requireTarget(services, input.sessionId);
      const files = await listProjectDesignFiles(target.cwd);
      const current = await services.design.currentPath(target);
      const result: DesignFilesResponse = {
        files: files.map((file) => ({ ...file, current: file.path === current })),
        currentPath: current,
      };
      return c.json(ok(result));
    } catch (error: unknown) {
      throw toAppError(error);
    }
  });

  // 一个节点的完整属性：会话文档或磁盘上的一份稿子（画布上的属性浮窗用）
  router.post("/node", jsonBody(designNodeInputSchema), async (c) => {
    const input = c.req.valid("json");
    try {
      const result: DesignNodeDetail = await services.design.node({
        ...requireTarget(services, input.sessionId),
        id: input.id,
      });
      return c.json(ok(result));
    } catch (error: unknown) {
      throw toAppError(error);
    }
  });

  router.post("/doc", jsonBody(designDocInputSchema), async (c) => {
    const input = c.req.valid("json") satisfies DesignDocInput;
    try {
      const result: DesignDocResponse = await services.design.doc({
        ...requireTarget(services, input.sessionId),
        action: input.action,
        ...(input.pageId === undefined ? {} : { pageId: input.pageId }),
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.path === undefined ? {} : { path: input.path }),
      });
      return c.json(ok(result));
    } catch (error: unknown) {
      throw toAppError(error);
    }
  });

  return router;
};
