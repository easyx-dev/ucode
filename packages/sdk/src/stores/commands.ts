/**
 * 命令与技能清单：按会话 / cwd 缓存。
 *
 * 目录解析结果只在建立会话或改动资源文件后变化，故按上下文缓存、用时加载，不做事件同步。
 */
import type { CommandsListRequest, PromptCommandView, SkillCommandView } from "@ucode/contracts";

import type { Apis } from "../apis";
import { createStore, type Store } from "../store";

export type CommandAssets = {
  prompts: PromptCommandView[];
  skills: SkillCommandView[];
};

export type CommandsState = {
  /** 按 `sessionId ?? cwd ?? ""` 索引 */
  byKey: Record<string, CommandAssets>;
};

export type CommandsStore = {
  getState: Store<CommandsState>["getState"];
  subscribe: Store<CommandsState>["subscribe"];
  /** 读取已缓存的清单；未加载时返回空清单 */
  get: (input: CommandsListRequest) => CommandAssets;
  /** 加载（或刷新）某上下文的清单 */
  load: (input: CommandsListRequest) => Promise<void>;
};

const EMPTY: CommandAssets = { prompts: [], skills: [] };

const keyOf = (input: CommandsListRequest): string => input.sessionId ?? input.cwd ?? "";

export const createCommandsStore = (deps: { apis: Apis }): CommandsStore => {
  const store = createStore<CommandsState>({ byKey: {} });

  return {
    getState: store.getState,
    subscribe: store.subscribe,
    get: (input) => store.getState().byKey[keyOf(input)] ?? EMPTY,
    async load(input) {
      const key = keyOf(input);
      try {
        const result = await deps.apis.commands.list(input);
        store.setState((prev) => ({
          ...prev,
          byKey: { ...prev.byKey, [key]: { prompts: result.prompts, skills: result.skills } },
        }));
      } catch {
        // 清单缺失只影响 `/` 菜单，保持空清单
      }
    },
  };
};
