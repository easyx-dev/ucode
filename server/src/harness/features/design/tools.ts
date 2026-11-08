/**
 * 设计工具的注册：工具名、给模型看的描述，以及执行接线。
 *
 * 描述里刻意讲了坐标系、先读再改、引用优先三件事——**模型不知道坐标系就会猜**，而猜出来的
 * x/y 每次都偏一个父节点的偏移。所以 `design_get_tree` 是所有描述的入口，其余工具都指回它。
 *
 * 白名单而不是把 SDK 的整份工具目录转发过来：那里面有一百多个工具，绝大多数设计轮次用不上，
 * 而全量注册会把真正需要的几个埋掉，也会把 SDK 的代码生成面拖进本模块。
 */
import { defineTool } from "@earendil-works/pi-coding-agent";
import type { TObject } from "typebox";

import { isDesignError } from "./errors";
import { DESIGN_PARAMETERS } from "./parameters";
import { runDesignTool } from "./run";
import type { DesignToolHooks } from "./types";

/** 模型可见的工具名；模式声明、装配与提示词共用这一份 */
export const DESIGN_TOOL_NAMES = [
  "design_get_tree",
  "design_get_node",
  "design_find_nodes",
  "design_get_selection",
  "design_create_shape",
  "design_update_node",
  "design_set_fill",
  "design_set_stroke",
  "design_set_text",
  "design_set_layout",
  "design_node_resize",
  "design_node_move",
  "design_delete_node",
  "design_group_nodes",
  "design_create_page",
  "design_open",
  "design_export_svg",
] as const;

export type DesignToolName = (typeof DESIGN_TOOL_NAMES)[number];

/** 一个工具的描述与提示词片段 */
type DesignToolSpec = {
  name: DesignToolName;
  description: string;
  /** 提示词「工具使用」一节的单行摘要 */
  snippet: string;
  /** 追加到提示词 Guidelines 的几条；只有需要跨轮记住的约定才写在这里 */
  guidelines?: string[];
};

const SPECS: readonly DesignToolSpec[] = [
  {
    name: "design_get_tree",
    description:
      "读当前页面：每个节点的 id、名称、类型、页面坐标与嵌套层级。**改之前先调它**——" +
      "id 要来自文档，不要猜。坐标从页面左上算起（x 向右、y 向下，单位像素），" +
      "不是相对父节点的偏移。节点多时用 maxDepth 只看浅层，或改用 design_find_nodes 按名字找。",
    snippet: "读设计页面上的节点（id / 名称 / 类型 / 页面坐标 / 层级）",
    guidelines: [
      "改设计之前先 design_get_tree 拿到真实 id：猜出来的 id 会改错节点，改错的节点用户看得见。",
    ],
  },
  {
    name: "design_get_node",
    description:
      "读一个节点的完整信息：几何、布局、填充与描边、文本内容与排版。用 id 或对话里的引用指定。",
    snippet: "读一个设计节点的完整属性",
  },
  {
    name: "design_find_nodes",
    description:
      "按名称子串和/or 类型在页面上找节点。用户说的是名字（「头部」「卡片」）而不是点选时用它。",
    snippet: "按名称或类型找设计节点",
  },
  {
    name: "design_get_selection",
    description: "读用户在画布上选中的节点。用户说「这个」「选中的那个」而没有点名时用它。",
    snippet: "读用户在画布上选中的节点",
  },
  {
    name: "design_create_shape",
    description:
      "在页面上建一个图形，返回它的 id。坐标是页面坐标。" +
      "**默认落在页面的画板里**（顶层只有一块 Frame 时）；给了 parentId 就嵌进那个节点，新建 Frame 则留在顶层。" +
      "从无到有做一张界面时，先建一块承载用的 Frame（如 375x812 的手机屏）；" +
      "**同一块区域（状态栏、顶部、一张卡片）先建一个容器 Frame 当组，再用 parentId 把元素放进去**" +
      "——层级靠嵌套表达，不要在名字里写「/」。",
    snippet: "在设计页面上新建图形（Frame / 矩形 / 椭圆 / 直线 / 文本）",
    guidelines: [
      "同一块区域先建容器 Frame，元素一律用 parentId 放进去；层级由嵌套表达，名字里不要写「/」。",
      "给新节点起能认出来的名字（「标题」「播放按钮」「封面」），不要留一堆 Frame 12。",
    ],
  },
  {
    name: "design_update_node",
    description: "改节点的名称或几何：只改给出的字段。用 id 或对话里的引用指定目标。",
    snippet: "改设计节点的名称 / 位置 / 尺寸 / 透明度 / 圆角",
  },
  {
    name: "design_set_fill",
    description: "把节点填充设成一种纯色。",
    snippet: "设置设计节点的填充色",
  },
  {
    name: "design_set_stroke",
    description: "把节点描边设成一种纯色并指定粗细。",
    snippet: "设置设计节点的描边",
  },
  {
    name: "design_set_text",
    description: "改文本节点的正文与排版：只改给出的字段。不能用在非文本节点上。",
    snippet: "改设计里文本节点的正文与排版",
  },
  {
    name: "design_set_layout",
    description:
      "把 Frame 变成自动布局容器或改它的布局：方向、间距、四边内边距、主轴分布与交叉轴对齐。",
    snippet: "设置设计节点的自动布局",
  },
  {
    name: "design_node_resize",
    description: "改一个节点的宽高，等价于 design_update_node 只给 width 与 height。",
    snippet: "调整设计节点的尺寸",
  },
  {
    name: "design_node_move",
    description: "把一个节点移到页面上的某个位置，等价于 design_update_node 只给 x 与 y。",
    snippet: "移动设计节点到页面坐标",
  },
  {
    name: "design_delete_node",
    description: "删除一个节点及它的全部子节点。不能从对话里撤销。",
    snippet: "删除设计节点及其子节点",
  },
  {
    name: "design_group_nodes",
    description:
      "把几个节点合成一个组，或把一个组解散回它的子节点。" +
      "已经平铺在页面上的稿子，可以按区域（状态栏、顶部、列表）选中后成组，让图层树能折叠。",
    snippet: "把设计节点成组 / 解散组",
  },
  {
    name: "design_create_page",
    description:
      "新建一页并返回它的 id。之后调工具时把该 id 作为 pageId 传下去，改动才会落在这一页上。" +
      "一页只放一份稿（例如「首页」「详情页」各一页），不要把所有界面堆在同一页里。",
    snippet: "新建设计页面",
  },
  {
    name: "design_open",
    description:
      "把本会话的画布指向一份已有的设计稿（`.design`，相对会话工作目录或绝对路径；不存在就新建）。" +
      "稿子只是文件，可以在项目里的任何位置；指向之后所有 design_* 工具都读写那一份。",
    snippet: "把画布指向另一份设计稿文件",
  },
  {
    name: "design_export_svg",
    description:
      "把整页或一个节点导出成会话工作目录里的 SVG 文件，返回路径。不传 id / ref 就导整页。",
    snippet: "把设计稿导出成 SVG 文件",
    guidelines: [
      "一次调用只做一件事：做一张完整界面需要多次调用是正常的，不要为了一次做完而跳过节点。",
      "改动后不要复述「我改了什么」清单——画布会自己刷新，用户看得见。",
    ],
  },
];

/** 把失败折成模型能照着改的一段话：原因 + 下一步（`DesignError` 自带 hint） */
const failureText = (error: unknown): string => {
  if (isDesignError(error)) {
    return error.hint === undefined ? error.message : `${error.message}\n下一步：${error.hint}`;
  }
  return error instanceof Error ? error.message : String(error);
};

/**
 * 建工具：一个会话一份，闭包着该会话的文档入口。
 *
 * 执行一律 sequential：同一轮里两条改动并发落到同一张图上，顺序就不可复现了。
 */
export const createDesignTools = (hooks: DesignToolHooks) =>
  SPECS.map((spec) =>
    defineTool({
      name: spec.name,
      label: spec.name,
      description: spec.description,
      promptSnippet: spec.snippet,
      ...(spec.guidelines === undefined ? {} : { promptGuidelines: spec.guidelines }),
      parameters: DESIGN_PARAMETERS[spec.name] as TObject,
      executionMode: "sequential" as const,
      async execute(_toolCallId, params) {
        try {
          const text = await runDesignTool(spec.name, params as Record<string, unknown>, hooks);
          return { content: [{ type: "text" as const, text }], details: {} };
        } catch (error: unknown) {
          // 设计稿是用户看得见的东西：失败必须让模型读到原因，而不是静默返回一句「完成」
          throw new Error(failureText(error));
        }
      },
    }),
  );
