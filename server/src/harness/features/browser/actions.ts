/**
 * 动作集：名称、模型侧入参，以及几个能脱离浏览器单测的纯判定（ref 归一、滚动换算、遮挡判定、
 * eval 结果格式化）。
 * 真正落到 Playwright 上的执行在 `session.ts`；遮挡的页面侧探测函数在这里，因为它与判定成对。
 *
 * 「笨」是刻意的（源方案 §3）：不做自动重试、不做自动等待，失败就带着原因与下一步交回去。
 */
import { type Static, Type } from "typebox";

import { type BrowserError, browserError, isBrowserError } from "./errors";

export const BROWSER_ACTIONS = [
  "click",
  "fill",
  "type",
  "press",
  "select",
  "scroll",
  "eval",
] as const;

export type BrowserAction = (typeof BROWSER_ACTIONS)[number];

/** 必须带 ref 的动作；`press` / `scroll` / `eval` 允许作用于页面本身 */
export const REF_REQUIRED_ACTIONS: readonly BrowserAction[] = ["click", "fill", "type", "select"];

/** 单次输入文本的长度上限：一次几万字符基本是误用，先拦下 */
export const MAX_TEXT_CHARS = 4_000;

/** eval 回传给模型的文本上限：读一个计算值用不了这么多，超了多半是写错了表达式 */
export const MAX_EVAL_RESULT_CHARS = 4_000;

/** 滚动一屏的默认像素：约等于常见视口高度，模型可用 amount 覆盖 */
export const DEFAULT_SCROLL_STEP = 600;

export const browserActParameters = Type.Object({
  action: Type.Union(
    [
      Type.Literal("click"),
      Type.Literal("fill"),
      Type.Literal("type"),
      Type.Literal("press"),
      Type.Literal("select"),
      Type.Literal("scroll"),
      Type.Literal("eval"),
    ],
    {
      description:
        "click 点击；fill 覆盖输入框内容；type 逐字输入（触发按键事件）；press 按键；" +
        "select 选择下拉项；scroll 滚动；eval 在页面里求值一段表达式并回传结果（读计算值用）",
    },
  ),
  ref: Type.Optional(
    Type.String({
      description:
        "元素编号，来自 browser_snapshot 的结果（如 @e1a2）；click / fill / type / select 必须给，" +
        "press 与 scroll 可省（省即作用于页面）",
    }),
  ),
  text: Type.Optional(
    Type.String({
      description:
        "fill / type 的文本；select 传选项的 value 或可见文本；eval 传要求值的表达式" +
        "（多句请写成 IIFE，如 (() => { const s = getComputedStyle(…); return { h: s.height }; })()）",
    }),
  ),
  key: Type.Optional(Type.String({ description: 'press 的按键，如 "Enter" / "Tab" / "Escape"' })),
  direction: Type.Optional(
    Type.Union(
      [Type.Literal("up"), Type.Literal("down"), Type.Literal("left"), Type.Literal("right")],
      {
        description: "scroll 的方向，默认 down",
      },
    ),
  ),
  amount: Type.Optional(
    Type.Number({ description: `scroll 的像素距离，默认 ${DEFAULT_SCROLL_STEP}` }),
  ),
});

export type BrowserActInput = Static<typeof browserActParameters>;

/** ref 归一：模型可能写 `@e1a2` 或 `e1a2`，两种都收 */
export const normalizeRef = (ref: string | undefined): string =>
  (ref ?? "").trim().replace(/^@/, "").toLowerCase();

export const scrollDelta = (
  direction: "up" | "down" | "left" | "right" = "down",
  amount = DEFAULT_SCROLL_STEP,
): { dx: number; dy: number } => {
  const distance =
    Number.isFinite(amount) && amount > 0
      ? Math.min(amount, 10 * DEFAULT_SCROLL_STEP)
      : DEFAULT_SCROLL_STEP;
  switch (direction) {
    case "up":
      return { dx: 0, dy: -distance };
    case "left":
      return { dx: -distance, dy: 0 };
    case "right":
      return { dx: distance, dy: 0 };
    default:
      return { dx: 0, dy: distance };
  }
};

/**
 * 中心点命中检测的页面侧结果。
 * `missing` 表示目标元素已不在文档里（编号失效）；`blocker` 是盖在目标上的元素描述。
 */
export type HitProbe = {
  matched: boolean;
  missing: boolean;
  /** 目标存在但无法判定（尺寸为 0、中心点在视口外） */
  undecidable?: boolean;
  reason?: string;
  blocker?: string;
};

/**
 * 遮挡判定（源方案 §6.3）：取元素中心坐标，用 `elementFromPoint` 看最顶层是不是它自己。
 * `isVisible()` 在这里没用——被遮罩盖住的元素在 DOM 里仍然「可见」，用它只会白等到超时。
 */
export const probeToError = (probe: HitProbe, ref: string): BrowserError | null => {
  if (probe.missing) {
    return browserError("stale_ref", `ref @${ref} 不在当前页面上`, {
      hint: "页面可能已变化，请重新调用 browser_snapshot",
    });
  }
  if (probe.matched) return null;
  const blocker = probe.blocker ? `被 ${probe.blocker} 挡住` : (probe.reason ?? "无法命中");
  return browserError("element_obstructed", `ref @${ref} ${blocker}`, {
    hint: "先关掉遮挡的弹层 / 滚动到目标，或改用遮挡层里的那个元素",
  });
};

/** 一个动作的入参解析结果：必填项与上限都在这里收口，执行层不再做判断 */
export type ResolvedAct = {
  action: BrowserAction;
  ref: string;
  /** fill / type 的文本、select 的选项值 */
  text: string;
  /** press 的按键 */
  key: string;
  direction: "up" | "down" | "left" | "right";
  amount?: number;
};

const requiredField = (action: BrowserAction): "key" | "text" =>
  action === "press" ? "key" : "text";

/**
 * 校验并归一动作入参：缺了必填项、或文本超上限就立即失败，
 * 而不是把半截参数交给 Playwright 换一个含义模糊的报错。
 */
export const resolveAct = (input: BrowserActInput): ResolvedAct => {
  const action = input.action as BrowserAction;
  const ref = normalizeRef(input.ref);
  if (REF_REQUIRED_ACTIONS.includes(action) && !ref) {
    throw browserError("ref_not_found", `${action} 需要 ref`, {
      hint: "先 browser_snapshot，把元素的 @e 编号传给 ref",
    });
  }

  const needsText = ["fill", "type", "select", "eval"].includes(action);
  const needsKey = action === "press";
  const field = requiredField(action);
  const raw = field === "key" ? input.key : input.text;
  if ((needsText || needsKey) && !raw) {
    const hint = needsKey
      ? '如 key: "Enter"'
      : action === "eval"
        ? "把表达式写在 text 里，如 document.title"
        : "把要输入的内容写在 text 里";
    throw browserError("action_failed", `${action} 需要 ${field}`, { hint });
  }
  if (raw && raw.length > MAX_TEXT_CHARS) {
    throw browserError("action_failed", `${field} 超过 ${MAX_TEXT_CHARS} 字符上限`, {
      hint: "分几次输入，或先用 fill 覆盖内容",
    });
  }

  return {
    action,
    ref,
    text: input.text ?? "",
    key: input.key ?? "",
    direction: input.direction ?? "down",
    ...(input.amount === undefined ? {} : { amount: input.amount }),
  };
};

/**
 * eval 的结果转成给模型的文本：字符串原样、其余类型紧凑 JSON。
 *
 * 取不到值时说清「表达式没有返回值」（模型会以为工具坏了）；序列化不了（循环引用、DOM 节点）也当场报错，
 * 而不是把 `{}` 递回去让它猜。
 */
export const formatEvalResult = (value: unknown): string => {
  if (value === undefined) {
    return "（表达式没有返回值：要取值请让它返回一个值，多句写成 IIFE）";
  }
  let text: string;
  if (typeof value === "string") {
    text = value === "" ? "（空字符串）" : value;
  } else {
    try {
      text = JSON.stringify(value) ?? String(value);
    } catch {
      throw browserError("action_failed", "表达式的结果无法序列化", {
        hint: "只回传可序列化的值（数字 / 字符串 / 数组 / 普通对象）；DOM 节点请在表达式里取值后再返回",
      });
    }
  }
  return text.length > MAX_EVAL_RESULT_CHARS
    ? `${text.slice(0, MAX_EVAL_RESULT_CHARS)}\n（结果已截断，共 ${text.length} 字符）`
    : text;
};

/**
 * eval 的失败包装：表达式被包成 `(() => (…))()`，所以多语句到这里必然语法报错——而那正是最常见的误用，
 * 提示必须点到「写成 IIFE」；其余异常给一个可执行的下一步，而不是通用重试建议。
 */
export const toEvalError = (error: unknown): BrowserError => {
  if (isBrowserError(error) && error.hint) return error;
  const raw = error instanceof Error ? error.message : String(error);
  const first = raw.split("\n")[0]?.trim() ?? raw;
  const hint = /syntaxerror|unexpected token/i.test(first)
    ? "表达式只包一层求值，多语句要写成 IIFE：(() => { const s = getComputedStyle(…); return { h: s.height }; })()"
    : "先在页面控制台里跑一遍这段表达式，确认它不报错、且返回可序列化的值";
  return browserError("action_failed", `表达式执行失败：${first}`, { hint, cause: error });
};
