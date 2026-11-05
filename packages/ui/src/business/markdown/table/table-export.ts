/**
 * 表格导出：把眼前这张表读成行列文本，再序列化成 Markdown（复制）或 CSV（下载）。
 *
 * 读渲染结果而不是 markdown 源：正文表格由 streamdown 流式产出，源文本不一定还在手上，导出即所见
 * （行内的 code / 链接还原成纯文本，富文本信息落不进去）。行列解析与转义直接用 streamdown 的表格工具，
 * 与它内建控件同一套口径（`|` 转义、单元格内换行转 `<br>`、HTML 实体），不必自己再写一遍。
 */
import { extractTableDataFromElement, tableDataToCSV, tableDataToMarkdown } from "streamdown";

import { downloadBlob, exportFileName } from "../download";

/** 表格文本 → Markdown 表源 */
export const tableToMarkdown = (table: HTMLElement): string =>
  tableDataToMarkdown(extractTableDataFromElement(table));

/** 导出并下载：BOM 让 Excel 认出 UTF-8，否则中文表头会乱码 */
export const downloadTableCsv = (table: HTMLElement, namePrefix: string): void => {
  const csv = tableDataToCSV(extractTableDataFromElement(table));
  downloadBlob(
    new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8" }),
    exportFileName(namePrefix, "csv"),
  );
};
