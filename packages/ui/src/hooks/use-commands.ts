/** 命令与技能清单的 React 绑定：按会话 / cwd 缓存，用时加载 */
import type { PromptCommandView, SkillCommandView } from "@ucode/contracts";
import { useEffect, useMemo } from "react";

import { useClient } from "../provider";
import { useStore } from "./use-store";

export type CommandAssets = {
  prompts: PromptCommandView[];
  skills: SkillCommandView[];
};

const EMPTY: CommandAssets = { prompts: [], skills: [] };

export function useCommands(sessionId: string | null, cwd?: string): CommandAssets {
  const client = useClient();
  const state = useStore(client.commands);
  const input = useMemo(() => (sessionId ? { sessionId } : cwd ? { cwd } : {}), [sessionId, cwd]);

  useEffect(() => {
    void client.commands.load(input);
  }, [client, input]);

  const key = sessionId ?? cwd ?? "";
  return state.byKey[key] ?? EMPTY;
}
