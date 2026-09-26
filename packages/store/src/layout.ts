import { homedir } from "node:os";
import { join } from "node:path";
import type { StorePaths } from "@ucode/data-layer-spec";

/**
 * 数据层的目录布局（spec §3.12）。
 *
 * 这是 **pi agent-dir 布局的超集**（ADR-001 的代价与收益）：`settings.json` / `models.json` /
 * `auth.json` / `AGENTS.md` / `extensions/` / `skills/` / `prompts/` / `themes/` 与 `sessions/`
 * 的名字都沿用 pi 的约定，因此 `PI_CODING_AGENT_DIR=<数据层目录>` 即可让 pi 生态直接读写。
 * 我们额外增加的是 `version`、`cache/`、`locks/`、`logs/`。
 */
export function storePaths(dataDir: string): StorePaths {
  return {
    dataDir,
    versionFile: join(dataDir, "version"),
    settings: join(dataDir, "settings.json"),
    models: join(dataDir, "models.json"),
    auth: join(dataDir, "auth.json"),
    sessions: join(dataDir, "sessions"),
    cache: join(dataDir, "cache"),
    locks: join(dataDir, "locks"),
    logs: join(dataDir, "logs"),
    extensions: join(dataDir, "extensions"),
    skills: join(dataDir, "skills"),
    prompts: join(dataDir, "prompts"),
    themes: join(dataDir, "themes"),
  };
}

/** 创建数据层时一并建好的目录（其余目录按需创建，比如用户放插件时）。 */
export function managedDirs(paths: StorePaths): string[] {
  return [paths.sessions, paths.cache, paths.locks, paths.logs];
}

/** 展开 `~` 并把相对路径按当前工作目录解析（`--data-dir` 的输入来自用户）。 */
export function resolveDataDir(input: string, cwd: string = process.cwd()): string {
  if (input === "~") return homedir();
  if (input.startsWith("~/")) return join(homedir(), input.slice(2));
  return input.startsWith("/") ? input : join(cwd, input);
}
