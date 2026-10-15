/**
 * CSS 颜色归一化：把设计 token 折成第三方组件认识的具体颜色。
 *
 * 外部组件（mermaid 的颜色引擎、xterm 的主题）只解析有限的一批写法（hex / rgb(a) / hsl(a) / 颜色关键字），
 * 而本仓库的 token 是 oklch（部分还带 color-mix 与 var()），直接传进去会被判为非法并退回它们自己的默认配色。
 * 这里借浏览器求值再采样：自定义属性用 `getComputedStyle` 读，含 `var()` / `color-mix()` 的表达式
 * 用隐藏探针元素算，最后统一经 1×1 canvas 拿回 sRGB 四通道——比在 JS 里自写 oklch → sRGB
 * 的数学转换更稳，也不必维护一份颜色格式清单。
 */

/** 采样得到的颜色：通道 0–255，alpha 0–1 */
type RgbaColor = {
  /** 红通道 */
  r: number;
  /** 绿通道 */
  g: number;
  /** 蓝通道 */
  b: number;
  /** 透明度 */
  a: number;
};

/** alpha 的小数位：够表达 token 里 12% / 50% 这类透明度档位 */
const ALPHA_PRECISION = 3;

/** 四通道 → 具体颜色写法；不透明时省掉 alpha，返回 `rgb(r, g, b)` */
export const formatRgbaColor = ({ r, g, b, a }: RgbaColor): string =>
  a >= 1
    ? `rgb(${r}, ${g}, ${b})`
    : `rgba(${r}, ${g}, ${b}, ${Number(a.toFixed(ALPHA_PRECISION))})`;

let sampler: CanvasRenderingContext2D | null | undefined;

/** 1×1 采样画布：整页共用一份；没有 DOM（测试、预渲染）时返回 null */
const getSampler = (): CanvasRenderingContext2D | null => {
  if (sampler !== undefined) return sampler;
  sampler = null;
  if (typeof document === "undefined") return sampler;
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (context) {
    // 直接覆盖像素，避免半透明色与画布底色叠加后 alpha 失真
    context.globalCompositeOperation = "copy";
    sampler = context;
  }
  return sampler;
};

/**
 * 任意 CSS 颜色 → `rgb()` / `rgba()`；浏览器不认这个格式、取值非法或没有 DOM 时返回 null，
 * 由调用方决定退回哪套内建配色。
 */
export const cssColorToRgb = (value: string): string | null => {
  const context = getSampler();
  const raw = value.trim();
  if (!context || !raw) return null;
  // 先认一下格式：浏览器不认时 canvas 会静默保留上一帧的像素，采出来的是错的颜色
  if (typeof CSS !== "undefined" && !CSS.supports("color", raw)) return null;
  try {
    context.fillStyle = raw;
    context.fillRect(0, 0, 1, 1);
    const [r = 0, g = 0, b = 0, a = 255] = context.getImageData(0, 0, 1, 1).data;
    return formatRgbaColor({ r, g, b, a: a / 255 });
  } catch {
    return null;
  }
};

/**
 * 读一个设计 token 的当前值并采样。值本身就是 oklch / color-mix 也无妨：
 * canvas 认这些写法，认不出来的由 `cssColorToRgb` 返回 null。
 */
export const cssVarColor = (name: string): string | null => {
  if (typeof document === "undefined") return null;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return raw ? cssColorToRgb(raw) : null;
};

let probe: HTMLElement | null | undefined;

/**
 * 求值一个含 `var()` / `color-mix()` 的颜色表达式。
 *
 * `canvas` 的 `fillStyle` 不认 `var()`（它没有继承上下文），`getPropertyValue` 又只会替换 `var()`
 * 而把 `color-mix()` 原样留下，所以要先把表达式挂到一个探针元素上让浏览器算完再采样。
 * 探针挂在文档里才继承得到根上的自定义属性，`display: none` 不影响取值。
 */
export const resolveCssColor = (expression: string): string | null => {
  if (typeof document === "undefined" || !document.body) return null;
  if (probe === undefined) {
    const element = document.createElement("div");
    element.style.display = "none";
    // 元素要在文档里，自定义属性才继承得到
    document.body.appendChild(element);
    probe = element;
  }
  if (!probe) return null;
  // 先清空再设：写法非法时 `style.color` 会保持上一次的值，不清就会采到错的颜色
  probe.style.color = "";
  probe.style.color = expression;
  return probe.style.color ? cssColorToRgb(getComputedStyle(probe).color) : null;
};
