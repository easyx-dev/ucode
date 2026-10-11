/**
 * 会话工作区：`$APP_HOME/workspace/<sessionId>`。
 *
 * **只属于未绑定目录的会话**（助理区那些）：它同时是这类会话的 cwd，见
 * `core/session-paths` 的 `resolveSessionCwd`；绑定目录的会话在用户自己的目录里干活，没有工作区。
 * 它就是个普通目录——里面放什么由任务决定，不预设子目录。
 * 目录名由会话 id 派生、不落额外状态；函数都接受可选的 `root`，便于测试注入临时目录。
 */
import { type Dirent, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

import { ERROR_CODES } from "@ucode/contracts";

import { env } from "../env";
import { AppError } from "../platform/response";

/**
 * 会话 id 会被拼进路径，这里按契约 `sessionIdSchema` 同款字符集再挡一道：
 * 只允许字母数字与 `._-`、首字符为字母数字，`..` / 分隔符 / 绝对路径都进不来。
 */
const SAFE_SESSION_ID = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;

const assertSafeSessionId = (sessionId: string): void => {
  if (!SAFE_SESSION_ID.test(sessionId)) {
    throw new AppError(ERROR_CODES.invalidRequest, `非法的会话 id：${sessionId}`, 400, undefined, {
      path: sessionId,
    });
  }
};

/** 会话工作区目录；只算路径不建目录 */
export const workspaceDirOf = (sessionId: string, root: string = env.workspacesDir): string => {
  assertSafeSessionId(sessionId);
  return join(root, sessionId);
};

/**
 * 把 Windows 的 `\` 与 POSIX 的 `/` 都当归一分隔符，并去掉尾部分隔符。
 *
 * 不按运行平台选分隔符（不读 `path.sep`）：会话 cwd 可能来自另一种写法的接口入参，
 * 同一份判定必须在两种写法下给出同一结论，也才好在任何平台上单测。
 */
const normalizeSeparators = (value: string): string =>
  value.replace(/\\/g, "/").replace(/\/+$/, "");

/**
 * 路径是否落在工作区之下：这些目录是服务分配给「未绑定目录的会话」的，不是用户的目录，
 * 因此不算项目（与 web 侧 `isWorkspaceSession` 同一口径，两边分组才不会分叉）。
 *
 * 严格位于之下才算：工作区根本身不算工作区。
 */
export const isWorkspaceCwd = (cwd: string, root: string = env.workspacesDir): boolean =>
  normalizeSeparators(cwd).startsWith(`${normalizeSeparators(root)}/`);

/**
 * 建出会话工作区目录（幂等）；路径只能从 `workspaceDirOf` 来，
 * 这样建目录这一侧也过同一道会话 id 校验，不会指到助理根之外。
 */
export const ensureWorkspaceDir = (sessionId: string, root: string = env.workspacesDir): void => {
  mkdirSync(workspaceDirOf(sessionId, root), { recursive: true });
};

/**
 * 清理孤儿工作区：没有对应会话行的目录。
 * 归档只隐藏会话、目录保留，所以这里兜的是对账删行、手工删库这类漏网情形；
 * 不设 TTL——目录在会话要跑时才建，DB 行必然先于它存在，「无行」就等于「无主」。
 */
export const cleanOrphanWorkspaces = (options: {
  keepIds: readonly string[];
  root?: string;
}): string[] => {
  const root = options.root ?? env.workspacesDir;
  const keep = new Set(options.keepIds);
  const removed: string[] = [];

  let entries: Dirent[];
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    // 工作区根还没建出来，无需清理
    return removed;
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || keep.has(entry.name)) continue;
    const dir = join(root, entry.name);
    try {
      rmSync(dir, { recursive: true, force: true });
      removed.push(entry.name);
    } catch {
      // 单个目录删不掉（权限等）不该中断整轮清理
    }
  }
  return removed;
};
