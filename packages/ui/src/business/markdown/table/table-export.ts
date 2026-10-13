/**
 * 表格导出：把眼前这张表读成行列文本，再序列化成 Markdown（复制）或 CSV（下载）。
 *
 * 读渲染结果而不是 markdown 源：正文表格由 streamdown 流式产出，源文本不一定还在手上，导出即所见
 * （行内的 code / 链接还原成纯文本，富文本信息落不进去）。行列解析与转义直接用 streamdown 的表格工具，
 * 与它内建控件同一套口径（`|` 转义、单元格内换行转 `<br>`、HTML 实体），不必自己再写一遍。
 */
import dayjs from "dayjs";
import { extractTableDataFromElement, tableDataToCSV, tableDataToMarkdown } from "streamdown";

/** 表格文本 → Markdown 表源 */
export const tableToMarkdown = (table: HTMLElement): string =>
  tableDataToMarkdown(extractTableDataFromElement(table));

/** 表格没有标题可用，文件名取「前缀 + 导出时刻」，反复导出不会互相覆盖 */
const csvFileName = (prefix: string): string =>
  `${prefix}-${dayjs().format("YYYYMMDD-HHmmss")}.csv`;

/** 导出并下载：BOM 让 Excel 认出 UTF-8，否则中文表头会乱码 */
export const downloadTableCsv = (table: HTMLElement, namePrefix: string): void => {
  const blob = new Blob([`\ufeff${tableDataToCSV(extractTableDataFromElement(table))}`], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = csvFileName(namePrefix);
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // 下载由 click 同步发起，但取数据要等这次任务跑完，故放到任务末尾回收
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
};
