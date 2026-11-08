/**
 * 设计工具的入参 schema（typebox，与其它自研工具同一套）。
 *
 * 两类片段反复出现，抽出来共用：**定位**（`id` / `ref` / `pageId`）与**颜色**。
 * 描述里反复点明「给了 ref 就以 ref 为准」「坐标是页面空间」——模型不写 id 就去猜，
 * 靠的是描述里这几句话。
 */
import { type TObject, Type } from "typebox";

/** 定位一个节点：锚点优先，其次 id */
const nodeTarget = {
  id: Type.Optional(
    Type.String({ description: "节点 id，取 design_get_tree / design_get_selection 报出来的那个" }),
  ),
  ref: Type.Optional(
    Type.String({
      description:
        "对话里的设计引用，形如 @design:<会话>/<页>/<节点>，由画布右键「加入对话」得到。" +
        "给了就以它为准（它指向用户亲自点选的节点），失配会直接报错而不是改一个看起来像的",
    }),
  ),
};

/** 这一页是哪一页；不给就取文档第一页 */
const pageId = {
  pageId: Type.Optional(
    Type.String({ description: "页 id，取 design_get_tree 报出来的；不给取第一页" }),
  ),
};

/** 颜色：CSS 写法，工具折成 0..1 通道 */
const color = Type.String({
  description: "CSS 颜色，如 #4F46E5 或 rgba(0,0,0,0.5)",
});

const opacity = Type.Optional(Type.Number({ description: "不透明度 0–1，默认 1" }));

/** 一页的树 / 检索参数 */
const treeParameters = Type.Object({
  ...pageId,
  maxDepth: Type.Optional(Type.Number({ description: "只列到这个嵌套层级（0 起）；不给就列整页" })),
});

const nodeParameters = Type.Object({ ...nodeTarget, ...pageId });

const selectionParameters = Type.Object({});

const findParameters = Type.Object({
  ...pageId,
  query: Type.Optional(Type.String({ description: "节点名里包含的子串；不给就不按名字过滤" })),
  type: Type.Optional(
    Type.String({ description: "只看这种节点类型，如 FRAME / TEXT / RECTANGLE / ELLIPSE / GROUP" }),
  ),
});

const createParameters = Type.Object({
  ...pageId,
  type: Type.Union(
    ["FRAME", "RECTANGLE", "ELLIPSE", "LINE", "TEXT"].map((kind) => Type.Literal(kind)),
    { description: "要建哪种图形" },
  ),
  name: Type.Optional(Type.String({ description: "图层名；留空会得到默认名，下一轮就认不出来了" })),
  x: Type.Optional(
    Type.Number({
      description:
        "左边缘的页面坐标（页面左上为原点）；不给就落在父节点左上角，" +
        "页面顶层新建的 Frame（一块新画板）则自动排在已有画板右侧",
    }),
  ),
  y: Type.Optional(
    Type.Number({
      description: "上边缘的页面坐标；单独给 x 或 y 时另一个轴保持原位",
    }),
  ),
  width: Type.Optional(Type.Number({ description: "宽（像素），默认 100" })),
  height: Type.Optional(Type.Number({ description: "高（像素），默认 100" })),
  text: Type.Optional(Type.String({ description: "正文；type 为 TEXT 时必填" })),
  parentId: Type.Optional(Type.String({ description: "放进这个节点里；不给就放在页面顶层" })),
});

const updateParameters = Type.Object({
  ...nodeTarget,
  ...pageId,
  name: Type.Optional(Type.String({ description: "新的图层名" })),
  x: Type.Optional(Type.Number({ description: "新的左边缘（页面坐标）" })),
  y: Type.Optional(Type.Number({ description: "新的上边缘（页面坐标）" })),
  width: Type.Optional(Type.Number({ description: "新的宽（像素）" })),
  height: Type.Optional(Type.Number({ description: "新的高（像素）" })),
  opacity: Type.Optional(Type.Number({ description: "不透明度 0–1" })),
  visible: Type.Optional(Type.Boolean({ description: "是否绘制" })),
  cornerRadius: Type.Optional(Type.Number({ description: "统一圆角（像素）" })),
});

const fillParameters = Type.Object({
  ...nodeTarget,
  ...pageId,
  color,
  opacity,
});

const strokeParameters = Type.Object({
  ...nodeTarget,
  ...pageId,
  color,
  weight: Type.Optional(Type.Number({ description: "描边粗细（像素）；不给就沿用当前值" })),
  opacity,
});

const textParameters = Type.Object({
  ...nodeTarget,
  ...pageId,
  characters: Type.Optional(Type.String({ description: "新的正文" })),
  fontSize: Type.Optional(Type.Number({ description: "字号（像素）" })),
  fontFamily: Type.Optional(Type.String({ description: "字体族名，如 Inter" })),
  fontWeight: Type.Optional(Type.Number({ description: "字重，如 400 / 700" })),
  textAlignHorizontal: Type.Optional(
    Type.Union(
      ["LEFT", "CENTER", "RIGHT", "JUSTIFIED"].map((value) => Type.Literal(value)),
      {
        description: "文本在框内的水平对齐",
      },
    ),
  ),
  lineHeight: Type.Optional(Type.Number({ description: "行高（像素）" })),
  letterSpacing: Type.Optional(Type.Number({ description: "字距（像素）" })),
});

const layoutParameters = Type.Object({
  ...nodeTarget,
  ...pageId,
  layoutMode: Type.Optional(
    Type.Union(
      ["NONE", "HORIZONTAL", "VERTICAL"].map((value) => Type.Literal(value)),
      {
        description: "自动布局方向；NONE 取消自动布局",
      },
    ),
  ),
  itemSpacing: Type.Optional(Type.Number({ description: "子节点间距（像素）" })),
  padding: Type.Optional(Type.Number({ description: "四边内边距（像素）" })),
  primaryAxisAlign: Type.Optional(
    Type.Union(
      ["MIN", "CENTER", "MAX", "SPACE_BETWEEN"].map((value) => Type.Literal(value)),
      {
        description: "主轴分布",
      },
    ),
  ),
  counterAxisAlign: Type.Optional(
    Type.Union(
      ["MIN", "CENTER", "MAX", "BASELINE"].map((value) => Type.Literal(value)),
      {
        description: "交叉轴对齐",
      },
    ),
  ),
});

const resizeParameters = Type.Object({
  ...nodeTarget,
  ...pageId,
  width: Type.Number({ description: "新的宽（像素）" }),
  height: Type.Number({ description: "新的高（像素）" }),
});

const moveParameters = Type.Object({
  ...nodeTarget,
  ...pageId,
  x: Type.Number({ description: "新的左边缘（页面坐标）" }),
  y: Type.Number({ description: "新的上边缘（页面坐标）" }),
});

const deleteParameters = Type.Object({ ...nodeTarget, ...pageId });

const groupParameters = Type.Object({
  ...pageId,
  ids: Type.Optional(
    Type.Array(Type.String(), { description: "要成组的节点 id；ungroup 为 true 时忽略" }),
  ),
  ungroup: Type.Optional(Type.Boolean({ description: "设为 true 表示解散 id 指定的那个组" })),
  id: Type.Optional(Type.String({ description: "ungroup 为 true 时要解散的组 id" })),
  name: Type.Optional(Type.String({ description: "新组的名字" })),
});

const createPageParameters = Type.Object({
  name: Type.Optional(Type.String({ description: "新页面的名字；不给就按「页面 N」编号" })),
});

const openParameters = Type.Object({
  path: Type.String({
    description: "要打开的 .design 文件：相对会话工作目录或绝对路径（不存在就新建）",
  }),
});

const exportParameters = Type.Object({
  ...nodeTarget,
  ...pageId,
  path: Type.Optional(
    Type.String({ description: "相对会话工作目录的路径，默认 design.svg；也可给绝对路径" }),
  ),
});

/** 工具名 → 入参 schema */
export const DESIGN_PARAMETERS: Record<string, TObject> = {
  design_get_tree: treeParameters,
  design_get_node: nodeParameters,
  design_find_nodes: findParameters,
  design_get_selection: selectionParameters,
  design_create_shape: createParameters,
  design_update_node: updateParameters,
  design_set_fill: fillParameters,
  design_set_stroke: strokeParameters,
  design_set_text: textParameters,
  design_set_layout: layoutParameters,
  design_node_resize: resizeParameters,
  design_node_move: moveParameters,
  design_delete_node: deleteParameters,
  design_group_nodes: groupParameters,
  design_create_page: createPageParameters,
  design_open: openParameters,
  design_export_svg: exportParameters,
};
