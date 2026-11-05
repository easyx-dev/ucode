/**
 * 正文里的导出：把一段字节存成本地文件，表格导 CSV 与图表导 SVG 共用这一份。
 *
 * 文件名取「前缀 + 导出时刻」：正文元素没有标题可用，而连续导出同名文件时浏览器只会默默加序号，
 * 带上时间戳反而好找。前缀由调用方按当前界面语言给（「表格」/「图表」）。
 */
import dayjs from "dayjs";

/** 文件名：前缀 + 导出时刻 + 扩展名，反复导出不会互相覆盖 */
export const exportFileName = (prefix: string, extension: string): string =>
  `${prefix}-${dayjs().format("YYYYMMDD-HHmmss")}.${extension}`;

/** 触发一次下载：锚点进 DOM 再点，行为与用户自己点链接一致 */
export const downloadBlob = (blob: Blob, fileName: string): void => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // 下载由 click 同步发起，但取数据要等这次任务跑完，故放到任务末尾回收
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
};
