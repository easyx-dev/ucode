/** `/goal` 命令解析：客户端识别开头为 `/goal` 的输入，转成目标操作而不是普通消息 */
export type GoalCommand =
  | { kind: "status" }
  | { kind: "pause" }
  | { kind: "resume" }
  | { kind: "clear" }
  | { kind: "set"; objective: string };

/**
 * 解析 `/goal` 命令；非 `/goal` 开头返回 null（按普通消息发送）。
 * 裸 `/goal` 查看状态；`replace <目标>` 与直接给目标都是设定（替换现有目标）。
 */
export const parseGoalCommand = (text: string): GoalCommand | null => {
  const trimmed = text.trim();
  if (!/^\/goal(\s|$)/i.test(trimmed)) return null;

  const rest = trimmed.replace(/^\/goal\s*/i, "").trim();
  if (rest === "") return { kind: "status" };

  const keyword = rest.toLowerCase();
  if (keyword === "status") return { kind: "status" };
  if (keyword === "pause") return { kind: "pause" };
  if (keyword === "resume") return { kind: "resume" };
  if (keyword === "clear") return { kind: "clear" };

  const replace = /^replace\s+([\s\S]+)$/i.exec(rest);
  if (replace?.[1]) return { kind: "set", objective: replace[1].trim() };
  return { kind: "set", objective: rest };
};
