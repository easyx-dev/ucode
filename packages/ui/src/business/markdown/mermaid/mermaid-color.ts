/**
 * Mermaid 主题色的归一化：把设计 token 的现代 CSS 颜色折成它认识的 rgb/rgba。
 *
 * mermaid 的颜色引擎（khroma）只解析 hex、rgb(a)、hsl(a) 与颜色关键字，而本仓库的 token 是
 * oklch（部分还带 alpha），直接传进去会解析失败并退回默认配色。这里借 canvas 采样：先让 `CSS.supports`
 * 确认浏览器认这个写法，再用 canvas 的 `getImageData` 拿回 sRGB 四通道值——比在 JS 里自写
 * oklch → sRGB 的数学转换更稳，也不必维护一份颜色格式清单。
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

/** 四通道 → khroma 认识的写法；不透明时省掉 alpha，返回 `rgb(r, g, b)` */
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
