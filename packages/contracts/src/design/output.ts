/**
 * 设计画布接口的响应模型。
 *
 * 文档在服务端（OpenPencil 的场景图），画布只收两样东西：结构摘要（点选与图层树用）与
 * 整页 drawing（画面用）。两者都带 `revision`——画布只会画自己那一版，陈旧的一律回 `null`。
 */

/** 文档里的一页 */
export type DesignPage = {
  id: string;
  name: string;
};

/**
 * 页面上一层节点的扁平摘要（父在前、子在后的深度优先序）。
 *
 * 坐标是**页面空间**（页面左上为原点，x 向右 y 向下，单位像素），不是相对父节点的偏移：
 * 画布的命中框与模型看到的数字必须是同一个口径，模型才能照着改。
 */
export type DesignNodeSummary = {
  id: string;
  /** 图层名；模型与用户都按它认节点，所以工具会要求起有意义的名字 */
  name: string;
  /** 节点类型：`FRAME` / `TEXT` / `RECTANGLE` / `ELLIPSE` / `LINE` / `GROUP` / `COMPONENT` 等 */
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** 父节点 id；页面直属节点为空 */
  parentId: string | null;
  /** 嵌套层级，页面直属节点为 0 */
  depth: number;
};

/** 一个节点的页面空间盒子，画布拿它做命中测试与选中描边 */
export type DesignBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/** 结构摘要：`revision` 一致就说明文档没变过 */
export type DesignSnapshot = {
  revision: number;
  pageId: string;
  pages: DesignPage[];
  nodes: DesignNodeSummary[];
  selection: string[];
  /**
   * 引用锚点前缀，形如 `@design:<会话 id>`；完整锚点由它 + `/<页>/<节点>` 拼成。
   * 由服务端铸造而不是画布自己拼：锚点写进对话历史后比文档活得久，归属校验靠的就是这一截。
   */
  mentionPrefix: string;
  /**
   * 这份稿子落在哪个文件。默认在项目配置目录下、按会话标题命名；
   * 用户把本会话的当前稿指向别处（`design/doc open`）时就是那个路径——画布上标出来，免得改错文件。
   */
  path: string;
  /**
   * 图层树是否被截断（超过服务端一次下发的行数上限）。
   * 带上它是为了让人知道「画布里还有没列出来的节点」，而不是以为稿子只有这些。
   */
  truncated?: boolean;
  /** 文档文件读不懂时给出的说明（已把坏文件留档），画布照实显示 */
  warning?: string;
};

/**
 * 整页 drawing。`svg` 为 `null` 表示「你手里那版已经是最新的」，画布不必重绘；
 * `boxes` 与 `svg` 出自同一次遍历，一个封套下发——拆成两条接口会拿到新图配旧几何。
 */
export type DesignRender = {
  revision: number;
  pageId: string;
  /** 整页 SVG 原文；空画布为空串，陈旧为 null */
  svg: string | null;
  boxes: Record<string, DesignBox>;
  /** 内容外接矩形；空画布为 null（画布据此收起「适应视图」） */
  bounds: DesignBox | null;
};

/** 选中集的写回结果 */
export type DesignSelection = {
  sessionId: string;
  selection: string[];
};

/** 文档级动作的结果；`pageId` 只在换页时给 */
export type DesignDocResponse = {
  revision: number;
  pageId?: string;
};

/** 设计稿目录里的一份文件 */
export type DesignFileEntry = {
  /** 绝对路径 */
  path: string;
  /** 文件名 */
  name: string;
  /** 最后改动时间（ISO） */
  updatedAt: string;
  /** 是否为本会话当前在改的那份 */
  current: boolean;
};

export type DesignFilesResponse = {
  /** 项目设计稿目录里的稿子，按改动时间倒序 */
  files: DesignFileEntry[];
  /**
   * 本会话当前在改的那份（可以把稿子放在目录外面，所以它不一定在 `files` 里）。
   * 由服务端给：侧栏与标签要的是这一个路径，不该为此去拉整页画面。
   */
  currentPath: string;
};

/** 一笔着色：通道是 0..1（SDK 的口径），界面自己折成颜色 */
export type DesignPaint = {
  /** 画法，目前只有 `SOLID` */
  type: string;
  color: { r: number; g: number; b: number; a: number };
  opacity: number;
  visible: boolean;
  /** 描边粗细（像素）；填充没有这一项 */
  weight?: number;
};

/** 文本节点的排版属性 */
export type DesignTextProps = {
  characters: string;
  fontSize: number;
  fontFamily: string;
  fontWeight: number;
  /** `LEFT` / `CENTER` / `RIGHT` / `JUSTIFIED` */
  textAlignHorizontal: string;
  /** 行高（像素）；未设置时为空 */
  lineHeight: number | null;
  letterSpacing: number;
};

/**
 * 一个节点的完整属性（画布上的属性浮窗用）。
 *
 * 与 `design_get_node` 工具给模型看的是同一份投影——人看到的和模型看到的数字必须是同一个，
 * 否则「把标题改成 24px」这种事两边会对不上。
 */
export type DesignNodeDetail = {
  id: string;
  name: string;
  /** 节点类型：`FRAME` / `TEXT` / `RECTANGLE` 等 */
  type: string;
  /** 图层路径，如 `我的 / 资料卡 / 标题` */
  path: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  visible: boolean;
  cornerRadius: number;
  fills: DesignPaint[];
  strokes: DesignPaint[];
  strokeWeight: number;
  /** 自动布局方向：`NONE` / `HORIZONTAL` / `VERTICAL` */
  layoutMode: string;
  itemSpacing: number;
  padding: { top: number; right: number; bottom: number; left: number };
  childCount: number;
  /** 文本属性；非文本节点没有 */
  text?: DesignTextProps;
};
