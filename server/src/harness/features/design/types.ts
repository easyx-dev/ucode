/**
 * 设计能力的对内类型：工具拿到的入口，以及文档在「读一次」里暴露的样子。
 *
 * 单独成文件是为了让装配层与工具层都能引用而不互相依赖：装配只注入，工具只消费
 * （同 `features/browser/hooks.ts` 的分工）。
 */
import type { FigmaAPI } from "@open-pencil/core/figma-api";
import type { SceneGraph } from "@open-pencil/scene-graph";

/** 读一次文档时拿到的东西；出了这次回调就不要再持有（没人看这份文件时会被回收） */
export type DesignDocumentView = {
  readonly graph: SceneGraph;
  readonly revision: number;
  /** 这份稿子在磁盘上的绝对路径：工具结果里要报出来，模型才知道自己在改哪份文件 */
  readonly path: string;
  /** 文档文件读不懂时的说明（已留档） */
  readonly warning?: string;
};

/** 工具侧入口：一个会话一份，由装配层按会话闭包出来 */
export type DesignToolHooks = {
  /** 本会话 id：校验引用锚点的归属要用它 */
  readonly sessionId: string;
  /** 本会话的工作目录；`design_export_svg` 的相对路径以它为基准 */
  readonly cwd: string;
  /**
   * 读一次文档，不涨 revision、不落盘。
   *
   * 操作本身可以是异步的（导出要现渲染）：`T` 取 `Promise<X>` 时返回值按 Promise 摊平，
   * `await` 一次就拿到 `X`。
   */
  read: <T>(operation: (view: DesignDocumentView) => T) => Promise<T>;
  /** 改一次文档：涨 revision、防抖落盘，并下发 `design_update` 帧 */
  mutate: <T>(operation: (api: FigmaAPI) => T) => Promise<T>;
  /** 画布当前的选中集（节点 id，按选中顺序） */
  selection: () => string[];
  /** 把本会话指向一份稿子（`.design`，相对工作目录或绝对路径；不存在就新建） */
  open: (path: string) => Promise<{ revision: number; pageId: string | undefined }>;
};
