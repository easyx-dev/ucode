/** 平台相关展示：修饰键标签（mac 用 ⌘，其余用 Ctrl+） */
const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent);

export const MOD_KEY_LABEL = isMac ? "⌘" : "Ctrl+";
