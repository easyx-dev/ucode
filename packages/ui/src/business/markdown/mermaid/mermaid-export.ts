/**
 * 图表导出：把渲染好的 SVG 存成文件。
 *
 * 导出 SVG 而不是栅格化成 PNG：图里的标签是 mermaid 产出的 `<foreignObject>`（HTML 标签），
 * canvas 画不出来（标签整片消失），换 PNG 得先把 mermaid 配成纯 `<text>` 标签，
 * 那会改变正文里的渲染效果。SVG 还保持矢量、文字可选、体积更小。
 */
import { downloadBlob, exportFileName } from "../download";

/**
 * mermaid 给的是 `width="100%"` + `viewBox`：留在页面里能按容器自适应，脱离页面后
 * 不少工具按 100% 算不出固有尺寸，这里按 viewBox 补上数字宽高。
 *
 * 按 HTML 解析而不是 XML：图里的标签是 `foreignObject` 里的 HTML，换行落成不闭合的 `<br>`，
 * 用 XML 解析会直接失败——而那份串本身也不是合法 SVG（存成文件打不开）。按 HTML 解析后再
 * 用 `XMLSerializer` 序列化，顺带把它修正成合法 XML。
 */
const withIntrinsicSize = (svg: string): string => {
  const root = new DOMParser().parseFromString(svg, "text/html").querySelector("svg");
  const box = root
    ?.getAttribute("viewBox")
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  if (!root || !box || box.length !== 4 || box.some((value) => !Number.isFinite(value))) return svg;
  root.setAttribute("width", String(box[2]));
  root.setAttribute("height", String(box[3]));
  return new XMLSerializer().serializeToString(root);
};

export const downloadMermaidSvg = (svg: string, namePrefix: string): void => {
  downloadBlob(
    new Blob([withIntrinsicSize(svg)], { type: "image/svg+xml;charset=utf-8" }),
    exportFileName(namePrefix, "svg"),
  );
};
