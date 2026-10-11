/**
 * 会话工作目录口径：绑定目录的会话用那个目录，未绑定的用按会话 id 派生的工作区。
 *
 * 它属于本服务的会话概念而不是 pi 的：装配层、服务层、路由与 pi 适配都要用它，
 * 所以归 core；pi 适配需要它时由调用方把解析结果当参数传进去（见 `harness/pi/{records,session-index}`）。
 *
 * 调用方只会拿到已存在的会话（`admitPrompt` 先挡了查不到的 id），所以这里没有兜底分支——
 * 不存在「没有记录」时该用哪个目录的说法，真要兜也只能兜到全局目录（`$APP_HOME`），那里放着密钥。
 */
import type { SessionRecord } from "../db/session-repository";
import { workspaceDirOf } from "./workspace";

export const resolveSessionCwd = (record: SessionRecord): string =>
  record.cwd || workspaceDirOf(record.id);
