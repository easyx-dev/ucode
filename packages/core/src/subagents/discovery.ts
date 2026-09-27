import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { storePaths } from "@ucode/store";
import { BUILTIN_PROFILES, parseSubagentProfile, type SubagentProfile } from "./profile.ts";

/**
 * 子智能体定义的发现（F-3.3）。
 *
 * 来源两级：**内置**（`general-purpose` / `explore`）+ **用户定义**（`<数据层>/agents/*.md`）。
 * 同名时用户定义覆盖内置——用户可以按自己的口味改写 `explore`，而不必换个名字。
 */

export type LoadProfilesResult = {
  profiles: SubagentProfile[];
  /** 定义层面的问题（不合法文件被跳过，但在诊断里留痕）。 */
  errors: string[];
};

export function agentsDirFor(dataDir: string): string {
  return storePaths(dataDir).agents;
}

export async function loadSubagentProfiles(dataDir: string): Promise<LoadProfilesResult> {
  const dir = agentsDirFor(dataDir);
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return { profiles: [...BUILTIN_PROFILES], errors: [] };
  }

  const byName = new Map<string, SubagentProfile>(
    BUILTIN_PROFILES.map((profile) => [profile.name, profile]),
  );
  const errors: string[] = [];
  for (const name of names) {
    if (!name.endsWith(".md")) continue;
    const file = join(dir, name);
    let markdown: string;
    try {
      markdown = await readFile(file, "utf8");
    } catch (error) {
      errors.push(`${file}: 读取失败（${String(error)}）。`);
      continue;
    }
    const parsed = parseSubagentProfile(markdown, file, name.replace(/\.md$/u, ""));
    if (typeof parsed === "string") {
      errors.push(parsed);
      continue;
    }
    byName.set(parsed.name, parsed);
  }
  return { profiles: [...byName.values()].sort((a, b) => a.name.localeCompare(b.name)), errors };
}

export function findProfile(
  profiles: readonly SubagentProfile[],
  name: string,
): SubagentProfile | undefined {
  return profiles.find((profile) => profile.name === name);
}
