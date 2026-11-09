/**
 * plugins.json 的读写：登记表与市场状态的唯一出口。
 *
 * 文件缺失时按初始状态建立（含内置市场）；解析失败直接报 `invalid_config`——这是我们自己写的
 * 状态文件，坏了就是坏了，不做静默丢弃。写入走「临时文件 + 重命名」，权限收紧到仅属主可读写
 * （里面有 `userConfig` 的值）。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { ERROR_CODES } from "@ucode/contracts";

import { env } from "../../env";
import {
  emptyPluginState,
  type InstalledPluginRecord,
  type PluginState,
  pluginStateSchema,
  withBuiltinMarketplaces,
} from "../../harness/plugins/state";
import { hardenOwnerOnly, OWNER_ONLY_MODE } from "../../platform/file-permissions";
import { AppError } from "../../platform/response";

/**
 * 清掉「来源已经不存在」的登记。
 *
 * 随包插件机制已移除（设计改成从官方市场按需安装）：老状态文件里那条 `source: "packaged"`
 * 会让整份状态解析失败、把别的插件一起搞丢，所以读之前把它摘掉——它不是用户装的插件，
 * 重新从市场装一次即可。
 */
const dropRemovedSources = (raw: unknown): unknown => {
  if (typeof raw !== "object" || raw === null) return raw;
  const state = raw as { installed?: unknown };
  if (!Array.isArray(state.installed)) return raw;
  return {
    ...state,
    installed: state.installed.filter(
      (item) =>
        !(
          typeof item === "object" &&
          item !== null &&
          (item as { source?: { source?: unknown } }).source?.source === "packaged"
        ),
    ),
  };
};

export class PluginStateStore {
  private state: PluginState = emptyPluginState();

  constructor(readonly path: string = env.pluginStatePath) {}

  load(): PluginState {
    if (!existsSync(this.path)) return this.set(emptyPluginState());
    try {
      const parsed = pluginStateSchema.parse(
        dropRemovedSources(JSON.parse(readFileSync(this.path, "utf8"))),
      );
      // 版本升级可能带来新的内置市场：并进状态并立刻落盘，否则老用户永远看不到它
      const merged = withBuiltinMarketplaces(parsed);
      this.state = merged === parsed ? parsed : this.set(merged);
    } catch (error) {
      throw new AppError(
        ERROR_CODES.invalidConfig,
        `插件状态文件解析失败：${this.path}`,
        500,
        String(error),
        { path: this.path },
      );
    }
    return this.state;
  }

  get(): PluginState {
    return this.state;
  }

  set(next: PluginState): PluginState {
    const parsed = pluginStateSchema.parse(next);
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(parsed, null, 2)}\n`, {
      encoding: "utf8",
      mode: OWNER_ONLY_MODE,
    });
    renameSync(tmp, this.path);
    hardenOwnerOnly(this.path);
    this.state = parsed;
    return parsed;
  }

  /** 变更入口的收口：改完状态后推进 revision，会话据此判断要不要重建 */
  update(mutate: (state: PluginState) => PluginState): PluginState {
    const next = mutate(this.state);
    return this.set({ ...next, revision: this.state.revision + 1 });
  }

  /** 按 id 取登记记录；未登记或已被移除时抛 `plugin_not_found` */
  requirePlugin(id: string): InstalledPluginRecord {
    const record = this.state.installed.find((item) => item.id === id);
    if (!record) {
      throw new AppError(ERROR_CODES.pluginNotFound, `插件不存在：${id}`, 404, undefined, { id });
    }
    return record;
  }
}
