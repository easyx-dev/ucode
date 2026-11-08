/**
 * OpenPencil SDK 的唯一入口：整个服务端只在这个文件里 import 它。
 *
 * 三件事决定了这里的形状：
 *
 * 1. **惰性加载**。多数会话不做设计，不该为它付启动成本（实测首次 import 约 340ms，
 *    而 `@open-pencil/core` 的包体是十兆级）。所以运行时用动态 import，只在第一次真的
 *    要读写设计稿时付这笔钱，之后走缓存。
 * 2. **只用两个 io 子路径**。主入口与 `io` barrel 会把 `dom-css` 拉进来，它背后的 `css-tree`
 *    用运行期 `require` 读自己的 JSON 数据——打进单文件就解析不到；还会顺带拉进编辑器需要的
 *    yoga（顶层 await）。画布只要「场景图 + SVG 渲染 + 内容边界」三样，子路径正合适。
 * 3. **这里是唯一的耦合面**。SDK 仍是 0.x，公共 API 会漂（改名、拆包），把 import 收在一个文件、
 *    对外只暴露四个函数，升版本时要动的就只是这里。
 */
import type { FigmaAPI } from "@open-pencil/core/figma-api";
import type { SceneGraph, VisualBounds } from "@open-pencil/scene-graph";

/** 设计文档用到的 SDK 能力，按本服务的口径收窄 */
export type DesignSdk = {
  /** 一张空图（只有文档根，没有页面） */
  createGraph: () => SceneGraph;
  /** 建立在图上的 Figma 插件 API；改动都走它返回的节点代理 */
  createApi: (graph: SceneGraph) => FigmaAPI;
  /** 把一批节点渲染成整页 SVG；没有可画的内容时返回 null */
  renderNodesToSvg: (
    graph: SceneGraph,
    pageId: string,
    nodeIds: readonly string[],
  ) => string | null;
  /** 内容外接矩形，用于「适应视图」；空集合返回 null */
  computeContentBounds: (graph: SceneGraph, nodeIds: readonly string[]) => VisualBounds | null;
  /** 图片字节在文档里的名字（十六进制 SHA-1，与 Figma 同一口径） */
  computeImageHash: (data: Uint8Array) => string;
};

let loading: Promise<DesignSdk> | undefined;

/** 取 SDK（首次调用时加载并缓存；失败不缓存，下一次调用会重试） */
export const loadDesignSdk = (): Promise<DesignSdk> => (loading ??= importSdk());

const importSdk = async (): Promise<DesignSdk> => {
  const [figmaApi, svg, raster, sceneGraph] = await Promise.all([
    import("@open-pencil/core/figma-api"),
    import("@open-pencil/core/io/formats/svg"),
    import("@open-pencil/core/io/formats/raster"),
    import("@open-pencil/scene-graph"),
  ]).catch((error: unknown) => {
    // 加载失败不该被记成「永久不可用」：装包不完整时用户重装一次就该能好
    loading = undefined;
    throw error;
  });
  return {
    createGraph: () => new sceneGraph.SceneGraph(),
    createApi: (graph) => new figmaApi.FigmaAPI(graph),
    renderNodesToSvg: (graph, pageId, nodeIds) => svg.renderNodesToSVG(graph, pageId, [...nodeIds]),
    computeContentBounds: (graph, nodeIds) => raster.computeContentBounds(graph, [...nodeIds]),
    computeImageHash: (data) => sceneGraph.computeImageHash(data),
  };
};
