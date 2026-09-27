// spike/memory-live.ts —— 真实模型下的记忆验证（手动跑，不进 CI）
//
//   cd spike && node memory-live.ts
//
// 覆盖两条路径：**写入**（agent 自己调 memory 工具落盘）与**回忆**（新会话从系统提示的
// 记忆 section 读到事实）。供应商配置来自 spike/.env（见 lib.ts）。
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  createAgentSession,
} from "@earendil-works/pi-coding-agent";
import {
  createMemoryExtension,
  listMemoryFacts,
  memoryDirFor,
} from "../packages/core/src/memory/index.ts";
import { PROVIDER, PROVIDER_NAME, makeAgentDir } from "./lib.ts";

const dataDir = makeAgentDir();
const cwd = mkdtempSync(join(tmpdir(), "mem-work-"));

function log(message: string): void {
  process.stdout.write(`${message}\n`);
}

const modelRuntime = await ModelRuntime.create({
  modelsPath: join(dataDir, "models.json"),
  authPath: join(dataDir, "auth.json"),
});
const model = modelRuntime.getModel(PROVIDER_NAME, PROVIDER.model);
if (model === undefined) throw new Error(`模型不可用：${PROVIDER_NAME}/${PROVIDER.model}`);

async function runSession(
  workdir: string,
  id: string,
  promptText: string,
): Promise<{ text: string }> {
  const loader = new DefaultResourceLoader({
    cwd: workdir,
    agentDir: dataDir,
    extensionFactories: [createMemoryExtension({ dataDir, cwd: workdir })],
  });
  await loader.reload();
  const manager = SessionManager.inMemory(workdir, { id });
  const { session } = await createAgentSession({
    cwd: workdir,
    agentDir: dataDir,
    modelRuntime,
    model,
    resourceLoader: loader,
    sessionManager: manager,
  });
  try {
    await session.prompt(promptText);
    return { text: session.getLastAssistantText() ?? "" };
  } finally {
    session.dispose();
  }
}

// 用一个模型不可能凭空猜到的随机代号：这样"回忆成功"只可能来自记忆，
// 负对照（换工作区）也能可靠地区分"真记得"与"碰巧答对"。
const code = `ZEBRA-${Math.floor(Math.random() * 9000 + 1000)}`;
// 条目名 verify-code 只可能来自注入的系统提示（模型猜不到），因此"能报出正文里的代号"
// 同时证明了注入与读取两条路径。显式要求调用工具，避免模型只看索引就作答。
const question =
  "请用 memory 工具读取 verify-code 条目，然后回答它的正文里写的验收代号。只回答代号本身。";

try {
  log(`（本次代号：${code}）`);
  log("① 新会话：让 agent 自己把这件事实写进记忆…");
  const first = await runSession(
    cwd,
    "live-1",
    [
      "请用 memory 工具记住这条项目事实：",
      `name=verify-code, description=本项目验收代号, type=project,`,
      `body=这个项目的验收代号是 ${code}，用 pnpm check 跑验收。`,
      "写完用一句话确认。",
    ].join(" "),
  );
  log(`   agent：${first.text.trim().slice(0, 120)}`);

  const facts = await listMemoryFacts(memoryDirFor(dataDir, cwd));
  log(`   落盘条目：${facts.map((f) => f.name).join(", ") || "(空)"}`);
  if (!facts.some((fact) => fact.name === "verify-code")) {
    throw new Error("失败：agent 没有把记忆写进数据层。");
  }

  log("② 新会话（不同会话 id，同一工作区）：问它代号…");
  const second = await runSession(cwd, "live-2", question);
  log(`   agent：${second.text.trim().slice(0, 120)}`);
  if (!second.text.includes(code)) {
    throw new Error("失败：新会话没能从记忆里回忆起代号。");
  }

  log("③ 负对照：换一个工作区（无记忆）问同样的问题…");
  const otherCwd = mkdtempSync(join(tmpdir(), "mem-other-"));
  try {
    const injected = await runSession(otherCwd, "live-3", question);
    log(`   agent：${injected.text.trim().slice(0, 120)}`);
    if (injected.text.includes(code)) {
      throw new Error("失败：无记忆的工作区居然答出了代号（说明注入并非按项目隔离）。");
    }
  } finally {
    await rm(otherCwd, { recursive: true, force: true });
  }

  log("\n✅ 通过：记忆写入落盘；新会话按项目回忆起来；无记忆的工作区答不出（因果成立）。");
} finally {
  await rm(dataDir, { recursive: true, force: true });
  await rm(cwd, { recursive: true, force: true });
}
