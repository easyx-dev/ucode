/**
 * 复制文本到剪贴板。
 *
 * 异步剪贴板 API（`navigator.clipboard`）只在安全上下文里存在：局域网明文 HTTP 打开时它是
 * `undefined`，而拿到权限后写入也仍可能被拒（页面失焦、剪贴板被别的程序占着）。这类场景下要退回
 * 老办法——把文本放进一个临时 `textarea` 选中后 `execCommand("copy")`。
 *
 * 返回是否成功，由调用方决定「静默保持原状」还是给提示；这里不抛错。
 */

/** 老办法：临时 textarea + 选中 + `execCommand("copy")` */
const copyBySelection = (text: string): boolean => {
  const area = document.createElement("textarea");
  area.value = text;
  // `display: none` / `visibility: hidden` 的元素选不中，`execCommand` 会拿到空内容，只能挪出视口
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.top = "0";
  area.style.left = "-9999px";
  document.body.appendChild(area);

  // 记下原选区：复制不该顺手把用户选中的东西弄没
  const selection = document.getSelection();
  const previous =
    selection && selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : null;

  try {
    area.select();
    // iOS 上 `select()` 不总会覆盖整段，补一次显式范围
    area.setSelectionRange(0, area.value.length);
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    area.remove();
    if (previous && selection) {
      selection.removeAllRanges();
      selection.addRange(previous);
    }
  }
};

/** 复制一段文本；两条路都走不通时返回 false（调用方按「没复制成」处理） */
export const copyText = async (text: string): Promise<boolean> => {
  const clipboard = globalThis.navigator?.clipboard;
  if (clipboard) {
    try {
      await clipboard.writeText(text);
      return true;
    } catch {
      // 权限被拒 / 页面失焦：落到下面的兜底
    }
  }
  return copyBySelection(text);
};
