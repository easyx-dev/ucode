// spike/wiki-live.ts —— Wiki 生成对真实模型的冒烟
//
//   cd spike && node wiki-live.ts
//
// 直接调核心层的 collect + generate（不经核心层进程）：验证"过滤掉不该读的、把该读的交给模型、
// 产出可用的 Markdown"这条链路在真实模型下成立。
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { collectWikiSources } from "../packages/core/src/wiki/collect.ts";
import { summarizeExclusions } from "../packages/core/src/wiki/filter.ts";
import { generateWiki } from "../packages/core/src/wiki/generate.ts";
import { PROVIDER, PROVIDER_NAME } from "./lib.ts";

function log(message: string): void {
  process.stdout.write(`${message}\n`);
}

/** 数据层目录：模型限额调大（推理模型会把额度花在 reasoning 上）。 */
const dataDir = mkdtempSync(join(tmpdir(), "wiki-agent-"));
writeFileSync(
  join(dataDir, "models.json"),
  JSON.stringify({
    providers: {
      [PROVIDER_NAME]: {
        baseUrl: PROVIDER.baseUrl,
        api: "openai-completions",
        apiKey: PROVIDER.apiKey,
        models: [
          {
            id: PROVIDER.model,
            name: "Smoke Model",
            input: ["text"],
            contextWindow: 32_000,
            maxTokens: 4_096,
          },
        ],
      },
    },
  }),
);

const cwd = mkdtempSync(join(tmpdir(), "wiki-work-"));
mkdirSync(join(cwd, "src"), { recursive: true });
mkdirSync(join(cwd, "node_modules", "left-pad"), { recursive: true });
writeFileSync(join(cwd, "README.md"), "# 示例项目\n\n一个用来演示 Wiki 生成的小仓库。\n");
writeFileSync(
  join(cwd, "src", "calc.ts"),
  "export function add(a: number, b: number): number {\n  return a + b;\n}\n",
);
writeFileSync(join(cwd, "src", "index.ts"), 'export { add } from "./calc.ts";\n');
writeFileSync(join(cwd, "node_modules", "left-pad", "index.js"), "module.exports = () => {};\n");
writeFileSync(join(cwd, ".env"), "SECRET_KEY=should-never-be-read\n");

let failed = false;
try {
  log("① 收集素材（应排除 node_modules 与 .env）…");
  const collection = await collectWikiSources(cwd);
  log(`   读入：${collection.files.map((file) => file.path).join(", ")}`);
  log(`   ${summarizeExclusions(collection.excluded)}`);
  if (collection.files.some((file) => file.path.includes("node_modules"))) {
    throw new Error("失败：node_modules 没被排除。");
  }
  if (collection.files.some((file) => file.path === ".env")) {
    throw new Error("失败：敏感文件 .env 被读入了。");
  }

  log("② 交给真实模型生成 Wiki…");
  const modelRuntime = await ModelRuntime.create({
    modelsPath: join(dataDir, "models.json"),
    authPath: join(dataDir, "auth.json"),
  });
  const result = await generateWiki({
    cwd,
    dataDir,
    modelRuntime,
    collection,
    instructions: "侧重说明这个项目有哪些模块。",
  });
  log("③ 产出（前 400 字）：");
  log(result.markdown.slice(0, 400));

  if (result.markdown.trim().length < 40) throw new Error("失败：生成的 Wiki 太短。");
  const size = (await stat(result.file)).size;
  log(`   已落盘：${result.file}（${size} 字节）`);

  // 敏感内容绝不能出现在产物里（模型没看到它，也就写不出来）。
  await writeFile(join(cwd, "unused.txt"), "");
  if (result.markdown.includes("should-never-be-read")) {
    throw new Error("失败：产物里出现了敏感内容，说明过滤没生效。");
  }

  log("\n✅ 通过：过滤生效（排除依赖与敏感文件）+ 真实模型产出并落盘。");
} catch (error) {
  failed = true;
  log(`\n❌ 失败：${error instanceof Error ? error.message : String(error)}`);
} finally {
  const rmOptions = { recursive: true, force: true, maxRetries: 5, retryDelay: 100 } as const;
  await rm(dataDir, rmOptions);
  await rm(cwd, rmOptions);
}

process.exit(failed ? 1 : 0);
