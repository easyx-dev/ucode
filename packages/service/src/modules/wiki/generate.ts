import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  createAgentSession,
  DefaultResourceLoader,
  type ModelRuntime,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { servicePaths } from "../../paths.ts";
import { writeFileAtomic } from "../../storage/index.ts";
import { projectMemoryKey } from "../memory/paths.ts";
import type { WikiCollection } from "./collect.ts";

/**
 * Wiki 生成（F-2.6）：把收集到的素材交给模型，产出一份 Markdown 项目说明。
 *
 * 用**一次性会话**而不是当前会话：生成过程不该污染用户正在进行的对话上下文，
 * 也不该让 Wiki 的中间推理出现在会话记录里。
 *
 * 产物落进数据层（`wiki/<project-key>.md`）：它是这个项目的派生资料，跟着数据层走，
 * 换壳/换会话都还在，也方便用户直接打开编辑。
 */

export function wikiFileFor(dataDir: string, cwd: string): string {
  return join(servicePaths(dataDir).wiki, `${projectMemoryKey(cwd)}.md`);
}

export type GenerateWikiOptions = {
  cwd: string;
  dataDir: string;
  modelRuntime: ModelRuntime;
  collection: WikiCollection;
  /** 用户附加的取向（例如"侧重架构"）。 */
  instructions?: string;
};

export function buildWikiPrompt(collection: WikiCollection, instructions?: string): string {
  const tree = collection.files.map((file) => `- ${file.path}`).join("\n");
  const bodies = collection.files
    .map((file) => `\n### ${file.path}\n\n\`\`\`\n${file.content}\n\`\`\``)
    .join("\n");
  return [
    "你在为一个软件项目写 Wiki（Markdown）。只依据下面给出的文件内容，不要臆测未出现的东西。",
    "结构建议：概览 / 目录结构 / 关键模块 / 运行与构建 / 约定与注意点。用中文写。",
    instructions === undefined || instructions.trim() === ""
      ? ""
      : `用户附加要求：${instructions.trim()}`,
    "",
    "文件清单：",
    tree,
    "",
    "文件内容：",
    bodies,
    "",
    "现在输出完整的 Wiki Markdown（不要前言后语，不要代码围栏包住整篇）。",
  ]
    .filter((part) => part !== "")
    .join("\n");
}

/** 生成并落盘，返回 Markdown 与文件路径。 */
export async function generateWiki(
  options: GenerateWikiOptions,
): Promise<{ markdown: string; file: string }> {
  const loader = new DefaultResourceLoader({ cwd: options.cwd, agentDir: options.dataDir });
  await loader.reload();
  const available = await options.modelRuntime.getAvailable();
  const model = available[0];
  const created = await createAgentSession({
    cwd: options.cwd,
    agentDir: options.dataDir,
    modelRuntime: options.modelRuntime,
    ...(model === undefined ? {} : { model }),
    resourceLoader: loader,
    sessionManager: SessionManager.inMemory(options.cwd),
  });
  try {
    await created.session.prompt(buildWikiPrompt(options.collection, options.instructions));
    const markdown = created.session.getLastAssistantText() ?? "";
    const file = wikiFileFor(options.dataDir, options.cwd);
    await mkdir(servicePaths(options.dataDir).wiki, { recursive: true, mode: 0o700 });
    await writeFileAtomic(file, markdown, { mode: 0o600 });
    return { markdown, file };
  } finally {
    created.session.dispose();
  }
}

export async function readWiki(dataDir: string, cwd: string): Promise<string | null> {
  try {
    return await readFile(wikiFileFor(dataDir, cwd), "utf8");
  } catch {
    return null;
  }
}
