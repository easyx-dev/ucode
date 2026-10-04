/** 命令与技能清单：按会话 / cwd 拉取并缓存，供 `/` 菜单使用 */
import { useEffect, useState } from "react";

import { api } from "@/lib/api";
import type { PromptCommandView, SkillCommandView } from "@/lib/types";

export type CommandAssets = {
  prompts: PromptCommandView[];
  skills: SkillCommandView[];
};

const EMPTY: CommandAssets = { prompts: [], skills: [] };

export function useCommands(sessionId: string | null, cwd?: string): CommandAssets {
  const [assets, setAssets] = useState<CommandAssets>(EMPTY);

  useEffect(() => {
    let cancelled = false;
    const body = sessionId ? { sessionId } : cwd ? { cwd } : {};
    api.commands
      .list(body)
      .then((result) => {
        if (!cancelled) setAssets({ prompts: result.prompts, skills: result.skills });
      })
      .catch(() => {
        if (!cancelled) setAssets(EMPTY);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, cwd]);

  return assets;
}
