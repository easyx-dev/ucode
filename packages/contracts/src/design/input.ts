/**
 * 设计画布接口的请求 zod 模型；`*Request` 为客户端载荷（z.input），`*Input` 为服务端解析后（z.infer）。
 *
 * 一律按会话寻址、不认路径：文档位置由会话工作目录派生（见 `harness/features/design`），
 * 因此画布只能问「这个会话的设计稿」，问不到这台机器上的任意文件。
 */
import { z } from "zod";

import { sessionIdSchema } from "../sessions/input";

/** 页面 id：由服务端下发（`designGetTree` 报告），不给就取文档第一页 */
const pageIdSchema = z.string().min(1).max(128);

/** 结构摘要：画布首屏、图层树与选中集都从这一条取 */
export const designSnapshotInputSchema = z.object({
  sessionId: sessionIdSchema,
  pageId: pageIdSchema.optional(),
});

export type DesignSnapshotInput = z.infer<typeof designSnapshotInputSchema>;
export type DesignSnapshotRequest = z.input<typeof designSnapshotInputSchema>;

/**
 * 整页 drawing。`revision` 是画布上一次画出来的那一版：服务端发现没变就回 `svg: null`，
 * 画布据此跳过重绘——轮询与事件驱动共用同一条判据。
 */
export const designRenderInputSchema = z.object({
  sessionId: sessionIdSchema,
  pageId: pageIdSchema.optional(),
  revision: z.number().int().nonnegative().optional(),
});

export type DesignRenderInput = z.infer<typeof designRenderInputSchema>;
export type DesignRenderRequest = z.input<typeof designRenderInputSchema>;

/**
 * 画布当前选中的节点。选中集不参与 revision（它不改文档），但模型要用它回答「这个」，
 * 所以单独落一条接口。不存在的 id 会被过滤掉，不让画布的错误状态变成模型的错误认知。
 */
export const designSelectInputSchema = z.object({
  sessionId: sessionIdSchema,
  ids: z.array(z.string().min(1).max(128)).max(256),
});

export type DesignSelectInput = z.infer<typeof designSelectInputSchema>;
export type DesignSelectRequest = z.input<typeof designSelectInputSchema>;

/**
 * 文档级动作：立刻落盘 / 清空重来 / 换一页 / 新建一页。
 *
 * 换页是视图状态（不涨 revision），新建页与清空是真正的改动（涨 revision 并落盘）。
 */
export const designDocInputSchema = z.object({
  sessionId: sessionIdSchema,
  action: z.enum(["flush", "reset", "setPage", "createPage", "open"]),
  pageId: pageIdSchema.optional(),
  /** 新建页的名字；不给就按「页面 N」编号 */
  name: z.string().min(1).max(60).optional(),
  /**
   * `open` 的目标文件：把本会话的当前稿指过去（指针随会话持久化；文件不存在就在第一次改动时新建）。
   * 相对路径按会话工作目录解析；扩展名必须是 `.design`（内容仍是 JSON）。
   */
  path: z.string().min(1).optional(),
});

export type DesignDocInput = z.infer<typeof designDocInputSchema>;
export type DesignDocRequest = z.input<typeof designDocInputSchema>;

/**
 * 列出项目设计稿目录里的稿子（工作台「设计」视图的侧栏）。
 *
 * 只认 `<cwd>/<项目配置目录>/design` 这一层：`.design` 可能在项目任何位置（`design/doc open`
 * 能指过去），但递归会把别的会话的工作区、构建产物与临时目录里的残片一并算进来。
 * `sessionId` 用来标出「本会话当前在改的那份」。
 */
export const designFilesInputSchema = z.object({
  sessionId: sessionIdSchema,
});

export type DesignFilesInput = z.infer<typeof designFilesInputSchema>;
export type DesignFilesRequest = z.input<typeof designFilesInputSchema>;

/**
 * 节点属性：读的是「本会话当前在改的那份」。画布打开即把会话指向该文件，
 * 所以这里只需要会话与节点 id，不需要路径。
 */
export const designNodeInputSchema = z.object({
  sessionId: sessionIdSchema,
  id: z.string().min(1).max(128),
});

export type DesignNodeInput = z.infer<typeof designNodeInputSchema>;
export type DesignNodeRequest = z.input<typeof designNodeInputSchema>;
