/**
 * 一个会话的设计文档：场景图、revision 与它落盘的那份文件。
 *
 * 文档为什么在服务端：OpenPencil 的编辑器要 yoga（顶层 await 的模块），浏览器侧装不进去；
 * 而把图留在服务端、让画布只收 drawing（见 `query.ts`），正好让「对话即主编辑器」成立——
 * 工具改这张图，画布只是观察者。
 *
 * 写入分两段：改动**同步**应用（一次调用看不见半应用的中间态），落盘**防抖排队**
 * （一串密集编辑只写一次，两次写入不会在同一路径上打架），文档回收时 flush，
 * 所以关掉服务不会丢最后一次改动。
 *
 * **读过不等于写过**：只看一眼设计稿（打开画布、读一次摘要）不落文件，第一次真正改动才把文件建出来。
 * 否则随便点一下工作台里的「设计」，用户仓库里就多一个设计稿文件。
 *
 * 文件是 JSON、不是 `.fig`：`.fig` 导出能用但读不回自己写的那份（实测 `invalid zip data`），
 * 走它就是在数据通路上埋一个丢数据的环节。JSON 存的是图自己的状态，读回来渲染结果一致。
 */
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { FigmaAPI } from "@open-pencil/core/figma-api";
import type { SceneGraph } from "@open-pencil/scene-graph";

import {
  DESIGN_BOARD_SIZE,
  DESIGN_DOCUMENT_FORMAT,
  DESIGN_WRITE_DEBOUNCE_MS,
} from "../../../constants/design";
import { designError } from "./errors";
import { referencedImageHashes } from "./images";
import { type DesignSdk, loadDesignSdk } from "./sdk";

/**
 * 文件里的描述信息。
 *
 * **不含任何会话信息**：稿子是项目里的普通文件，归属由服务端的内存指针回答，不写进文件。
 * 这里只留给人看的东西——这份稿子叫什么、什么时候建的。
 */
export type DesignMeta = {
  title?: string;
  /** 首次落盘时间（ISO）；只读展示用 */
  createdAt?: string;
};

/** 文档在磁盘上的形状：每个字段都是图自己的状态 */
type StoredDocument = {
  format: number;
  /** 写在最前面：`paths` 找文件时只读头几 KB 就能认出来 */
  meta: DesignMeta;
  rootId: string;
  nodes: unknown[];
  variables: unknown[];
  variableCollections: unknown[];
  activeMode: Record<string, string>;
  documentColorSpace?: string;
  /** 图片按内容哈希存 base64 */
  images: Record<string, string>;
};

/** 一张图与建立在它之上的插件 API：改动都走 API 返回的节点代理，直接改裸记录不生效 */
type DocumentGraph = { graph: SceneGraph; api: FigmaAPI };

export type DesignDocument = {
  /** 文档文件绝对路径 */
  readonly path: string;
  /** 当前图；`reset` 之后取到的是新的那张 */
  readonly graph: SceneGraph;
  /** 建立在当前图上的插件 API */
  readonly api: FigmaAPI;
  /** 每次成功改动的代数；画布靠它判断要不要重取 */
  revision: () => number;
  /** 文档文件读不懂时的说明（已把坏文件留档），没有则为 undefined */
  warning: () => string | undefined;
  /** 改一次文档；操作抛错则不涨 revision、不落盘 */
  mutate: <T>(operation: (api: FigmaAPI) => T) => Promise<T>;
  /** 立刻落盘（取消防抖） */
  flush: () => Promise<void>;
  /** 落盘并收尾（文档被回收时调） */
  close: () => Promise<void>;
  /** 清空重来：换成一张只有空白画板的新图 */
  reset: () => Promise<void>;
};

export type OpenDocumentOptions = {
  /** 防抖时长；测试可注小值 */
  writeDebounceMs?: number;
  /** 归属信息：写进文件，供按会话找回 */
  meta?: DesignMeta;
  /**
   * 只读打开（预览文件树里的稿子用）：不落盘、也不把读不懂的文件改名留档——
   * 那不是「这个会话的稿坏了」，只是打开了一个不该动的文件。
   */
  readOnly?: boolean;
};

type OpenedDocument = DocumentGraph & { notice?: string; dirty: boolean; meta: DesignMeta };

/**
 * 打开（或新建）一个会话的设计文档。
 *
 * 读不懂的文件会被改名留档而不是删掉：里面是用户画的东西，而这里出 bug 比用户主动丢弃更可能。
 */
export const openDesignDocument = async (
  path: string,
  options: OpenDocumentOptions = {},
): Promise<DesignDocument> => {
  const sdk = await loadDesignSdk();
  const opened = await openFromDisk(path, sdk, options.readOnly === true);
  let current: DocumentGraph = { graph: opened.graph, api: opened.api };
  let revision = 0;
  let notice = opened.notice;
  let dirty = opened.dirty;
  /** 是否被改过：没改过就一个字节都不写（见文件头的「读过不等于写过」） */
  let mutated = false;
  // 归档时间只认第一次落盘：每次写都刷新它，等于让文件在 git 里每存一次就变一次
  const meta: DesignMeta = {
    ...options.meta,
    createdAt: opened.meta.createdAt ?? new Date().toISOString(),
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  let writing: Promise<void> = Promise.resolve();
  const debounceMs = options.writeDebounceMs ?? DESIGN_WRITE_DEBOUNCE_MS;

  const serialize = (): string => {
    // 只留还被填充引用到的图：换回色块的那张不该继续躺在文件里（文件只涨不缩）
    const used = referencedImageHashes(current.graph);
    const stored: StoredDocument = {
      format: DESIGN_DOCUMENT_FORMAT,
      meta,
      rootId: current.graph.rootId,
      nodes: [...current.graph.nodes.values()],
      variables: [...current.graph.variables.values()],
      variableCollections: [...current.graph.variableCollections.values()],
      activeMode: Object.fromEntries(current.graph.activeMode),
      ...(current.graph.documentColorSpace === undefined
        ? {}
        : { documentColorSpace: String(current.graph.documentColorSpace) }),
      images: Object.fromEntries(
        [...current.graph.images.entries()]
          .filter(([hash]) => used.has(hash))
          .map(([hash, bytes]) => [hash, Buffer.from(bytes).toString("base64")]),
      ),
    };
    return JSON.stringify(stored);
  };

  const flush = async (): Promise<void> => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    if (!mutated || !dirty) return writing;
    dirty = false;
    const body = serialize();
    // 排队用一条「永不 reject」的链，错误单独回传：catch 之后把 rejected 的 promise 留在链上，
    // 之后每次 flush 都会跳过写体、原地复述同一个旧错误——一次 EACCES 就把落盘永久焊死
    const run = writing.then(async () => {
      await mkdir(dirname(path), { recursive: true });
      const temporary = `${path}.tmp`;
      await writeFile(temporary, body, "utf8");
      await rename(temporary, path);
    });
    writing = run.catch(() => undefined);
    return run.catch((error: unknown) => {
      // 写失败把脏标记放回去：下一轮 flush 会带着最新内容重写
      dirty = true;
      throw error;
    });
  };

  const schedule = (): void => {
    if (timer !== undefined) return;
    timer = setTimeout(() => {
      timer = undefined;
      void flush().catch(() => undefined);
    }, debounceMs);
    // 未 unref 的定时器会让进程在收尾时多等一会儿
    timer.unref?.();
  };

  const replace = async (next: DocumentGraph): Promise<void> => {
    current = next;
    revision += 1;
    dirty = true;
    mutated = true;
    await flush();
  };

  return {
    path,
    get graph() {
      return current.graph;
    },
    get api() {
      return current.api;
    },
    revision: () => revision,
    warning: () => notice,
    mutate: async (operation) => {
      const result = operation(current.api);
      revision += 1;
      dirty = true;
      mutated = true;
      schedule();
      return result;
    },
    flush,
    close: async () => {
      await flush().catch(() => undefined);
      await writing.catch(() => undefined);
    },
    reset: async () => {
      notice = undefined;
      await replace(seedGraph(sdk));
    },
  };
};

/** 删掉文档文件（会话归档时用） */
export const removeDesignDocument = async (path: string): Promise<void> => {
  await unlink(path).catch(() => undefined);
};

/**
 * 从磁盘打开：没有文件就用手上的种子图（**不落盘**），读不懂就留档再用种子图。
 *
 * 两种情况都不标脏：种子图是确定性生成的，重建一次与读回来等价；真正的文件等到第一次改动才写。
 */
const openFromDisk = async (
  path: string,
  sdk: DesignSdk,
  readOnly: boolean,
): Promise<OpenedDocument> => {
  const raw = await readText(path);
  if (raw === undefined) return { ...seedGraph(sdk), dirty: false, meta: {} };
  try {
    const { graph, meta } = restoreGraph(raw, sdk);
    return { graph, api: sdk.createApi(graph), dirty: false, meta };
  } catch (error: unknown) {
    // 只读打开时把错误原样抛给调用方：预览一个坏文件不该把它改名
    if (readOnly) throw error;
    const aside = `${path}.corrupt-${Date.now()}`;
    await rename(path, aside).catch(() => undefined);
    const reason = error instanceof Error ? error.message : String(error);
    return {
      ...seedGraph(sdk),
      notice: `文档文件读不懂（${reason}），已留档为 ${aside}`,
      dirty: false,
      meta: {},
    };
  }
};

/** 读文件；不存在返回 undefined，其余错误照抛（读不了要让人看见，不能当成空文档） */
const readText = async (path: string): Promise<string | undefined> => {
  try {
    return await readFile(path, "utf8");
  } catch (error: unknown) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return undefined;
    throw designError("io_failed", `读取设计稿失败：${path}`, "检查目录权限与磁盘状态");
  }
};

/**
 * 种子图：默认页 + 一块空白画板。
 *
 * 空图只有文档根，画布没有任何可画的东西；给一页一画板，新会话就有地方落第一屏的内容，
 * 工具层也不必为「页面还没有画板」单开一条分支。这块板就是第一屏，不是「装多屏的箱子」——
 * 同一页的其余屏是并列的新画板（见 `document.ts` 与设计模式的提示词）。
 */
const seedGraph = (sdk: DesignSdk): DocumentGraph => {
  const graph = sdk.createGraph();
  const api = sdk.createApi(graph);
  // 默认页由 SDK 造出来时叫 `Page 1`：界面上是给人看的名字，按本项目的语言换掉
  const page = graph.getPages()[0];
  if (page !== undefined) page.name = "页面 1";
  const board = api.createFrame();
  board.name = "画板";
  board.resize(DESIGN_BOARD_SIZE.width, DESIGN_BOARD_SIZE.height);
  board.x = 0;
  board.y = 0;
  return { graph, api };
};

/** 从文件内容重建图；形状不认就抛错（由调用方留档） */
const restoreGraph = (text: string, sdk: DesignSdk): { graph: SceneGraph; meta: DesignMeta } => {
  const stored = JSON.parse(text) as StoredDocument;
  if (stored.format !== DESIGN_DOCUMENT_FORMAT) {
    throw new Error(`未知的文档格式 ${String(stored.format)}`);
  }
  if (
    !Array.isArray(stored.nodes) ||
    !Array.isArray(stored.variables) ||
    !Array.isArray(stored.variableCollections)
  ) {
    throw new Error("文档缺少节点或变量列表");
  }
  const graph = sdk.createGraph();
  graph.nodes = new Map(
    stored.nodes.map((entry) => [(entry as { id: string }).id, entry as never]),
  );
  graph.variables = new Map(
    stored.variables.map((entry) => [(entry as { id: string }).id, entry as never]),
  );
  graph.variableCollections = new Map(
    stored.variableCollections.map((entry) => [(entry as { id: string }).id, entry as never]),
  );
  graph.rootId = stored.rootId;
  graph.activeMode = new Map(Object.entries(stored.activeMode ?? {}));
  if (stored.documentColorSpace !== undefined) {
    graph.documentColorSpace = stored.documentColorSpace as SceneGraph["documentColorSpace"];
  }
  graph.images = new Map(
    Object.entries(stored.images ?? {}).map(([hash, base64]) => [
      hash,
      Uint8Array.from(Buffer.from(base64, "base64")),
    ]),
  );
  return { graph, meta: stored.meta ?? {} };
};
