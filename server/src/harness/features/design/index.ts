/**
 * 设计画布服务：文档按**文件路径**持有，会话只记「当前在改哪份」。
 *
 * 三条口径决定了这里的形状：
 *
 * 1. **一份文件 = 一份内存文档**。键是绝对路径，所以两个会话打开同一份稿时用的是同一个 graph、
 *    同一条写队列——不会出现两份副本互相覆盖，也就没有「归属」这回事。
 * 2. **会话只记指针**（`pointers`）：它存在会话上、随会话持久化，从不写进稿子文件。
 *    打开一份稿就是「把指针指过去」（`design_open` / `design/doc open`）。
 * 3. **工具必须知道自己在改哪份**。没有指针时**报错**而不是回落到默认路径——静默落到另一份文件
 *    是这类功能最坏的失败（agent 改了一份，用户看的是另一份）。新稿的默认位置只由画布那条链路
 *    用（`currentPath` + `doc open`）来确立。
 *
 * 开启是并发的（画布首屏、工具调用、事件重取同时到达），所以「打开」按路径去重，同一个文件只真的读一次盘。
 */
import { stat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

import type {
  DesignDocResponse,
  DesignNodeDetail,
  DesignRender,
  DesignSelection,
  DesignSnapshot,
} from "@ucode/contracts";
import { DESIGN_FILE_EXTENSION, DESIGN_TREE_ROW_LIMIT } from "../../../constants/design";
import { expandHome } from "../../../platform/paths";
import { type DesignDocument, openDesignDocument } from "./document";
import { designError } from "./errors";
import type { DesignHooks } from "./hooks";
import { mentionPrefixOf } from "./mention";
import { defaultDesignPath } from "./paths";
import { describeNode, listPages, pageNodes, renderPage, resolvePageId } from "./query";

/** 一次请求的落点：哪个会话、它的工作目录在哪 */
export type DesignTarget = {
  sessionId: string;
  /** 会话工作目录：新稿落在 `<cwd>/<项目配置目录>/design/` */
  cwd: string;
};

export type DesignServiceDeps = {
  /** 下发 `design_update` 帧（按「当前在改这份文件」的会话逐个发） */
  emitUpdate: (sessionId: string, revision: number) => void;
  /**
   * 会话标题：新稿的文件名取自它（`音乐 App 首页.design` 比一串 uuid 有用）。
   * 起名是异步的、也可能一直为空，所以只在**新建文件**时取一次。
   */
  titleOf?: (sessionId: string) => string | null;
  /** 会话指针的持久层：服务本身不持有它，重启后靠它接上 */
  pointers: DesignPointerStore;
};

/** 会话「当前在改哪份稿」的持久读写；实现落在会话仓储（`session.design_path`） */
export type DesignPointerStore = {
  /** 读会话记下的路径；没记过为 null */
  get: (sessionId: string) => string | null;
  /** 记下路径；null 表示清除 */
  set: (sessionId: string, path: string | null) => void;
  /** 全部会话已占用的路径：算默认落点时避开它们，免得两个会话分到同一份稿 */
  used: () => string[];
};

export type DesignService = DesignHooks & {
  /**
   * 本会话正在改的那份稿（没打开过就是默认落点，**不建文件**）。
   * 画布与侧栏靠它决定「当前」是哪一份；总有一个值（默认落点总能算出来）。
   */
  currentPath: (target: DesignTarget) => Promise<string>;
  /** 结构摘要（画布首屏与图层树） */
  snapshot: (input: DesignTarget & { pageId?: string }) => Promise<DesignSnapshot>;
  /** 整页 drawing；`revision` 与文档一致时 `svg` 为 null */
  render: (input: DesignTarget & { pageId?: string; revision?: number }) => Promise<DesignRender>;
  /** 一个节点的完整属性（画布上的属性浮窗用） */
  node: (input: DesignTarget & { id: string }) => Promise<DesignNodeDetail>;
  /** 写回画布选中集 */
  select: (input: DesignTarget & { ids: readonly string[] }) => Promise<DesignSelection>;
  /** 文档级动作：立刻落盘 / 清空重来 / 换一页 / 指向另一份稿 */
  doc: (
    input: DesignTarget & {
      action: "flush" | "reset" | "setPage" | "createPage" | "open";
      pageId?: string;
      /** 新建页的名字；不给就按编号 */
      name?: string;
      /** `open` 的目标文件（相对会话工作目录或绝对路径） */
      path?: string;
    },
  ) => Promise<DesignDocResponse>;
  /** 进程收尾：所有文档落盘 */
  disposeAll: () => Promise<void>;
};

/** 客户端请求（画布）允许回落到默认落点；工具调用不允许 */
type ResolveOptions = { allowDefault: boolean };

export const createDesignService = (deps: DesignServiceDeps): DesignService => {
  /** 键是绝对路径：同一份文件全进程只有一份文档 */
  const documents = new Map<string, DesignDocument>();
  /**
   * 进程内的指针缓存：命中就不必回持久层取。它只是 `deps.pointers` 的副本，
   * 唯一事实源是会话上那份（重启后按需回填）。
   */
  const focused = new Map<string, string>();
  /** 画布选中集按会话：同一个文件被两个会话打开时，各自的选中互不干扰 */
  const selections = new Map<string, string[]>();
  const opening = new Map<string, Promise<DesignDocument>>();
  const closing = new Map<string, Promise<void>>();

  /** 本会话当前在改哪份；缓存未命中回持久层取一次 */
  const focusedOf = (sessionId: string): string | undefined => {
    const cached = focused.get(sessionId);
    if (cached !== undefined) return cached;
    const stored = deps.pointers.get(sessionId);
    if (stored === null) return undefined;
    focused.set(sessionId, stored);
    return stored;
  };

  /** 指针换到另一份：缓存与持久层同一笔写入，不留两个真值源 */
  const remember = (sessionId: string, path: string): void => {
    focused.set(sessionId, path);
    deps.pointers.set(sessionId, path);
  };

  const forgetPath = (sessionId: string): void => {
    focused.delete(sessionId);
    deps.pointers.set(sessionId, null);
  };

  /** 反查「谁在看这份文件」：只看进程内缓存——重启后没载入的会话没有在线画布，不需要通知 */
  const sessionsFocusedOn = (path: string): string[] =>
    [...focused.entries()].filter(([, value]) => value === path).map(([sessionId]) => sessionId);

  /** 没有会话在改这份文件了就回收：先落盘再放引用，之后重新打开不会读到半截 */
  const releaseIfUnused = async (path: string): Promise<void> => {
    if (sessionsFocusedOn(path).length > 0) return;
    const document = documents.get(path);
    documents.delete(path);
    if (document === undefined) return;
    const closed = document.close();
    closing.set(path, closed);
    void closed.finally(() => {
      if (closing.get(path) === closed) closing.delete(path);
    });
  };

  const openAt = async (path: string, sessionId: string): Promise<DesignDocument> => {
    const existing = documents.get(path);
    if (existing !== undefined) return existing;
    const inflight = opening.get(path);
    if (inflight !== undefined) return inflight;
    // 占位先于 await：等上一次回收落盘期间并发请求会各开一份，后一份覆盖 Map、前一份脱离管理
    const task = (async () => {
      const pending = closing.get(path);
      if (pending !== undefined) {
        await pending;
        closing.delete(path);
      }
      const title = deps.titleOf?.(sessionId) ?? null;
      return openDesignDocument(path, { meta: title === null ? {} : { title } });
    })()
      .then((document) => {
        documents.set(path, document);
        return document;
      })
      .finally(() => opening.delete(path));
    opening.set(path, task);
    return task;
  };

  /** 算本会话的默认落点（只在没有指针时用到），并把它当成正式的指针记下 */
  const deriveDefault = async (target: DesignTarget): Promise<string> => {
    const derived = await defaultDesignPath({
      cwd: target.cwd,
      title: deps.titleOf?.(target.sessionId) ?? null,
      used: deps.pointers.used(),
    });
    remember(target.sessionId, derived);
    return derived;
  };

  /** 这次请求该落到哪份文件：会话指针优先；没有指针时只有画布能回落到默认落点 */
  const pathOf = async (target: DesignTarget, options: ResolveOptions): Promise<string> => {
    const path = focusedOf(target.sessionId);
    if (path !== undefined) return path;
    if (!options.allowDefault) {
      throw designError(
        "not_found",
        "这个会话还没有打开任何设计稿",
        "先用 design_open 指定一份（用户在画布上打开标签也会聚焦它），或让用户在设计视图里开一份",
      );
    }
    return deriveDefault(target);
  };

  const documentOf = async (
    target: DesignTarget,
    options: ResolveOptions = { allowDefault: true },
  ): Promise<DesignDocument> => openAt(await pathOf(target, options), target.sessionId);

  const selectionOf = (sessionId: string): string[] => selections.get(sessionId) ?? [];

  /**
   * 把本会话的画布指向一份稿子（`design_open` / `design/doc open` / 画布打开标签）。
   *
   * 稿子只是一个文件，可以在项目任何位置。指向之后：
   * - 本会话的指针换成它（缓存与持久层同一笔写入），旧的那份若没人再看就落盘回收；
   * - 文件已在内存里（别的会话正开着）就直接复用那一份，谁改都看得见；
   * - 文件不存在就在第一次改动时新建；存在但读不懂则这一步就报错，不把会话指过去。
   */
  const focusDocument = async (
    target: DesignTarget,
    requested: string | undefined,
  ): Promise<DesignDocument> => {
    if (requested === undefined || requested.trim() === "") {
      throw designError("invalid_input", "open 需要 path", "给一份 .design 文件的路径");
    }
    const expanded = expandHome(requested.trim());
    const path = isAbsolute(expanded) ? expanded : resolve(target.cwd, expanded);
    if (!path.endsWith(DESIGN_FILE_EXTENSION)) {
      throw designError(
        "invalid_input",
        `只能打开 ${DESIGN_FILE_EXTENSION} 文件：${path}`,
        "设计稿的扩展名是 .design（内容仍是 JSON）",
      );
    }
    const existing = await stat(path).catch(() => null);
    if (existing?.isFile()) {
      await openDesignDocument(path, { readOnly: true })
        .then((probe) => probe.close())
        .catch((error: unknown) => {
          throw designError(
            "not_found",
            `这不是一份能读的设计稿：${path}`,
            error instanceof Error ? error.message : String(error),
          );
        });
    }
    const previous = focusedOf(target.sessionId);
    remember(target.sessionId, path);
    selections.delete(target.sessionId);
    if (previous !== undefined && previous !== path) await releaseIfUnused(previous);
    return openAt(path, target.sessionId);
  };

  /** 文档变了：通知所有正在改这份文件的会话（同一个文件可能被两个会话同时看着） */
  const emit = (document: DesignDocument): void => {
    for (const sessionId of sessionsFocusedOn(document.path)) {
      deps.emitUpdate(sessionId, document.revision());
    }
  };

  return {
    snapshot: async (input) => {
      const document = await documentOf(input);
      const pageId = resolvePageId(document.graph, input.pageId);
      const summary = pageNodes(document.graph, pageId, { limit: DESIGN_TREE_ROW_LIMIT });
      return {
        revision: document.revision(),
        pageId,
        pages: listPages(document.graph),
        nodes: summary.rows,
        selection: selectionOf(input.sessionId),
        mentionPrefix: mentionPrefixOf(input.sessionId),
        path: document.path,
        ...(summary.truncated ? { truncated: true } : {}),
        ...(document.warning() === undefined ? {} : { warning: document.warning() }),
      };
    },
    render: async (input) => {
      const document = await documentOf(input);
      const pageId = resolvePageId(document.graph, input.pageId);
      // 与画布手里那版一致就不重算：渲染是这里最贵的一步，而画布多数时候只是在跟随
      if (input.revision !== undefined && input.revision === document.revision()) {
        return { revision: document.revision(), pageId, svg: null, boxes: {}, bounds: null };
      }
      return renderPage(document.graph, pageId, document.revision());
    },
    node: async (input) => {
      const document = await documentOf(input);
      return describeNode(document.graph, input.id);
    },
    select: async (input) => {
      const document = await documentOf(input);
      const known = input.ids.filter((id) => document.graph.getNode(id) !== undefined);
      selections.set(input.sessionId, known);
      return { sessionId: input.sessionId, selection: known };
    },
    doc: async (input) => {
      if (input.action === "open") {
        const opened = await focusDocument(input, input.path);
        emit(opened);
        return { revision: opened.revision(), pageId: listPages(opened.graph)[0]?.id };
      }
      const document = await documentOf(input);
      if (input.action === "flush") {
        await document.flush();
        return { revision: document.revision() };
      }
      if (input.action === "reset") {
        await document.reset();
        selections.delete(input.sessionId);
        emit(document);
        return { revision: document.revision() };
      }
      if (input.action === "createPage") {
        const created = await document.mutate((api) => {
          const page = api.graph.addPage(input.name ?? `页面 ${api.graph.getPages().length + 1}`);
          const proxy = api.getNodeById(page.id);
          // 新建的这一页成为当前页：工具不传 pageId 时落在它上面，与用户看到的一致
          if (proxy !== null) api.currentPage = proxy;
          return page;
        });
        emit(document);
        return { revision: document.revision(), pageId: created.id };
      }
      // 换页是视图状态：不涨 revision，否则每切一次页都会让所有画布重取一遍
      if (input.pageId === undefined) {
        throw designError("invalid_input", "setPage 需要 pageId");
      }
      resolvePageId(document.graph, input.pageId);
      return { revision: document.revision(), pageId: input.pageId };
    },
    toolHooks: (input) => ({
      sessionId: input.sessionId,
      cwd: input.cwd,
      // 工具不许回落到默认落点：改哪份必须由「用户打开了哪份」决定
      read: async (operation) => {
        const document = await documentOf(input, { allowDefault: false });
        return operation({
          graph: document.graph,
          revision: document.revision(),
          path: document.path,
          ...(document.warning() === undefined ? {} : { warning: document.warning() }),
        });
      },
      mutate: async (operation) => {
        const document = await documentOf(input, { allowDefault: false });
        const result = await document.mutate(operation);
        emit(document);
        return result;
      },
      selection: () => selectionOf(input.sessionId),
      open: async (path) => {
        const document = await focusDocument(input, path);
        emit(document);
        return { revision: document.revision(), pageId: listPages(document.graph)[0]?.id };
      },
    }),
    currentPath: async (target) => {
      const path = focusedOf(target.sessionId);
      if (path !== undefined) return path;
      // 故意不走 `deriveDefault`：清单只是「问一下现在会落在哪」，不该因此把指针写进会话
      return defaultDesignPath({
        cwd: target.cwd,
        title: deps.titleOf?.(target.sessionId) ?? null,
        used: deps.pointers.used(),
      });
    },
    /**
     * 会话出池（空闲回收、改配置或换模式都会走到）：**只放文档，指针留着**。
     *
     * 指针是「用户还开着哪份稿」，跟池里有没有实例无关——出池就把指针删掉的话，
     * 用户眼前明明是那张画布，agent 下一次调用却会报「还没有打开任何设计稿」。
     * 文档本身没人看就落盘回收，下次访问重开。
     */
    release: (sessionId) => {
      const path = focusedOf(sessionId);
      if (path === undefined) return;
      void releaseIfUnused(path);
    },
    /** 会话归档 / 删除：连指针一起丢（归档后它不会再被访问） */
    forget: (sessionId) => {
      const path = focusedOf(sessionId);
      forgetPath(sessionId);
      selections.delete(sessionId);
      if (path === undefined) return;
      void releaseIfUnused(path);
    },
    disposeAll: async () => {
      const pending = [...documents.values()].map((document) => document.close());
      documents.clear();
      selections.clear();
      focused.clear();
      await Promise.all([...pending, ...closing.values()]).catch(() => undefined);
    },
  };
};
