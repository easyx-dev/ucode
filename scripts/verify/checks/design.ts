/**
 * 设计系统守卫（见 DESIGN.md）。
 *
 * 拦的是「绕过 token 直接写字面尺寸 / 旧 token 名 / 白名单外的档位」这类写法：
 * 它们单处看不出问题，攒起来就是界面失去一致性的根源。
 *
 * 允许的例外只与「相对约束」有关：百分比与视口单位（`h-[60vh]`、`max-w-[85%]`、`calc(100%-2rem)`）
 * 表达的是相对布局，与设计系统的绝对尺寸档位无关；绝对单位（px / rem / em）一律走档位。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { listFiles } from "../files.ts";

type Rule = { test: RegExp; message: string };

const RULES: Rule[] = [
  // 字号：只用六档 + 图表三档，禁任意值与超出体系的档位
  {
    test: /text-\[[^\]]*(?:px|rem|em)[^\]]*\]/,
    message: "字号禁任意值：用 text-xs/sm/base/lg/xl/2xl 或 text-chart-*",
  },
  {
    test: /\btext-(?:3xl|4xl|5xl|6xl)\b/,
    message: "字号只有六档：text-xs/sm/base/lg/xl/2xl",
  },

  // 图标：四档，跟随字号（size-6 及以上是按钮与头像的盒子，不在此列）
  {
    test: /\bsize-(?:3|3\.5|4|5)(?![\d.])/,
    message: "图标用 size-icon-xs/sm/base/lg，不写原始档位",
  },

  // 旧 token 名：新体系里已被替代
  {
    test: /muted-foreground/,
    message: "muted-foreground 已删除：用 foreground-subtle / foreground-subtlest",
  },
  {
    test: /\bbg-accent\b|text-accent-foreground/,
    message: "accent 已删除：交互态用 state-hover / state-selected",
  },
  {
    test: /sidebar-accent|bg-sidebar\b|text-sidebar-foreground/,
    message: "sidebar-* 已删除：侧栏用 state-* 与 foreground",
  },
  {
    test: /border-input|\bbg-input\b|bg-input\//,
    message: "input 色已并入 border：用 border-border",
  },
  { test: /ring-foreground\//, message: "浮层描边用 ring-border-strong" },

  // 焦点环：统一 2px
  { test: /focus-visible:ring-(?:3|\[)/, message: "焦点环固定 2px：focus-visible:ring-2" },
  { test: /aria-invalid:ring-(?:3|\[)/, message: "错误态焦点环固定 2px：aria-invalid:ring-2" },

  // 高度层：只用语义名
  {
    test: /\bshadow-(?:sm|md|lg|xl|2xl)\b/,
    message: "阴影只用 shadow-raised / shadow-popover / shadow-dialog / shadow-edge",
  },

  // 圆角：只用四档 + full
  { test: /\brounded-(?:2xl|3xl|4xl)\b/, message: "圆角只有 sm/md/lg/xl/full 五档" },
  { test: /rounded-\[(?!inherit)/, message: "圆角禁任意值：按最近圆角父容器取档" },

  // 动效
  {
    test: /\btransition-all\b/,
    message: "禁 transition-all：写明过渡属性（colors / opacity / transform）",
  },
  { test: /\bduration-(?!100\b|150\b|200\b)\d+/, message: "时长只有 100 / 150 / 200ms 三档" },
  { test: /\bease-(?!out\b|linear\b)\w+/, message: "缓动只用 ease-out（线性扫光类动效除外）" },

  // 层级：数字档位只允许 10/20/50
  { test: /\bz-(?!10\b|20\b|50\b)\d+/, message: "层级数字档位只用 z-10 / z-20 / z-50" },
  // 命名档位单独一条：上面那条只认数字，`z-chrome` 这类名字会整个漏过去。
  // 排掉 `index`：`z-index` 不是类名，是注释里写层级时难免出现的词
  {
    test: /(?:^|[\s"'`])z-(?!chrome\b|index\b)[a-z][a-z-]*(?=[\s"'`]|$)/,
    message: "层级命名档位只有 z-chrome（见 DESIGN.md「层级」）",
  },

  // 绝对尺寸：禁任意值（百分比与视口单位是相对约束，放行）
  {
    test: /(?:^|[\s"'`])(?:w|h|min-w|max-w|min-h|max-h|size|gap|gap-x|gap-y|p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr)-\[(?![\d.]+(?:%|vw|vh|dvw|dvh)|calc\(|max\(|min\(|env\()/,
    message: "尺寸禁任意值：走间距档位；相对约束用百分比或视口单位",
  },

  // 渐变：默认不用装饰渐变
  {
    test: /bg-(?:linear|radial|conic)-|linear-gradient\(/,
    message: "禁自造渐变：加载态用 shimmer / scroll-fade",
  },

  // 透明度：只用叠加色阶（state 层由 CSS 合成，不在组件里写）
  {
    test: /(?:bg|text|border|ring|fill|stroke|decoration)-(?!none\b)[a-z-]+\/(?!5\b|10\b|20\b|40\b|50\b|60\b|80\b)\d+/,
    message: "透明度只用 5/10/20/40/50/60/80 七档",
  },

  // 交互态：一律走叠加态，不用 muted 实色（否则卡片与弹层上的悬停深浅不一致）
  {
    test: /\b(?:hover|focus|active|aria-expanded|data-\[state=open\]):bg-muted/,
    message: "交互态底色用 state-hover / state-selected / state-active，不用 muted",
  },

  // 间距：只允许登记过的档位（越档要先进 DESIGN.md 与本白名单）
  {
    test: /(?:^|[\s"'`])(?:gap|gap-x|gap-y|p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr)-(?!0\b|0\.5\b|1\b|1\.5\b|2\b|2\.5\b|3\b|4\b|5\b|6\b|7\b|8\b|9\b|12\b)\d+/,
    message: "间距只用允许档位（0/0.5/1/1.5/2/2.5/3/4/5/6/7/8/9/12）",
  },
];

export const run = (root: string): string[] => {
  const problems: string[] = [];
  const files = ["apps/web/src", "apps/desktop/src/renderer", "packages/ui/src"].flatMap((dir) =>
    listFiles(root, dir, (path) => /\.tsx?$/.test(path)),
  );

  for (const file of files) {
    const lines = readFileSync(join(root, file), "utf8").split("\n");
    for (const [index, line] of lines.entries()) {
      for (const rule of RULES) {
        if (rule.test.test(line)) problems.push(`${file}:${index + 1}：${rule.message}`);
      }
    }
  }

  return problems;
};
