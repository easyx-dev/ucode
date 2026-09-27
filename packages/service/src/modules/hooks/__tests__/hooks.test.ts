import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadHookRegistrations } from "../config.ts";
import { matchesHookMatcher, mergeHookRuns, parseHookOutput } from "../output.ts";
import { runHook, runHooks } from "../runner.ts";
import type { HookInput, HookRegistration, HookRunResult } from "../types.ts";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "hooks-test-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const baseInput: HookInput = {
  event: "PreToolUse",
  sessionId: "s1",
  cwd: process.cwd(),
  toolName: "bash",
  toolInput: { command: "rm -rf /" },
};

/** 一段读取 stdin 再输出决定的 node 脚本（避免依赖 shell 引号）。 */
function nodeHook(body: string): string[] {
  return [process.execPath, "-e", body];
}

describe("matchesHookMatcher", () => {
  it("省略或 * 匹配全部", () => {
    expect(matchesHookMatcher(undefined, "bash")).toBe(true);
    expect(matchesHookMatcher("*", "bash")).toBe(true);
  });
  it("精确名与 | 列表", () => {
    expect(matchesHookMatcher("bash", "bash")).toBe(true);
    expect(matchesHookMatcher("bash", "read")).toBe(false);
    expect(matchesHookMatcher("bash|write", "write")).toBe(true);
    expect(matchesHookMatcher("bash|write", "read")).toBe(false);
  });
  it("正则匹配", () => {
    expect(matchesHookMatcher("/^wr/", "write")).toBe(true);
    expect(matchesHookMatcher("/^wr/", "read")).toBe(false);
  });
  it("无主体的事件不按匹配器裁剪", () => {
    expect(matchesHookMatcher("bash", undefined)).toBe(true);
  });
});

describe("parseHookOutput", () => {
  it("解析决定与原因", () => {
    expect(parseHookOutput('{"decision":"deny","reason":"no"}')).toEqual({
      decision: "deny",
      reason: "no",
    });
  });
  it("容忍日志在前、JSON 在最后一行", () => {
    expect(parseHookOutput('检查中…\n{"decision":"allow"}')).toEqual({ decision: "allow" });
  });
  it("空对象与非法 JSON 都不算决定", () => {
    expect(parseHookOutput("{}")).toBeNull();
    expect(parseHookOutput("not json")).toBeNull();
    expect(parseHookOutput("")).toBeNull();
  });
  it("未知决定值被忽略", () => {
    expect(parseHookOutput('{"decision":"maybe"}')).toBeNull();
  });
});

describe("mergeHookRuns", () => {
  const run = (output: HookRunResult["output"]): HookRunResult => ({
    registration: { event: "PreToolUse", command: "x" },
    output,
    durationMs: 1,
  });

  it("deny 胜 ask 胜 allow", () => {
    const merged = mergeHookRuns([
      run({ decision: "allow" }),
      run({ decision: "ask" }),
      run({ decision: "deny" }),
    ]);
    expect(merged.decision).toBe("deny");
  });
  it("continue:false 等价拒绝并置 stop", () => {
    const merged = mergeHookRuns([run({ continue: false, reason: "别继续" })]);
    expect(merged.decision).toBe("deny");
    expect(merged.stop).toBe(true);
    expect(merged.reasons).toContain("别继续");
  });
  it("无决定时保持 null", () => {
    expect(mergeHookRuns([run({ reason: "只是说句话" })]).decision).toBeNull();
  });
  it("追加上下文全部收集", () => {
    const merged = mergeHookRuns([
      run({ additionalContext: "A" }),
      run({ additionalContext: "B" }),
    ]);
    expect(merged.additionalContext).toEqual(["A", "B"]);
  });
});

describe("loadHookRegistrations", () => {
  it("缺失文件时视为无钩子", async () => {
    const result = await loadHookRegistrations(join(root, "nope.json"));
    expect(result.registrations).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it("合法条目被接受，非法条目报错但不影响其余", async () => {
    const file = join(root, "hooks.json");
    await writeFile(
      file,
      JSON.stringify({
        hooks: [
          { event: "PreToolUse", matcher: "bash", command: "true" },
          { event: "Nope", command: "true" },
          { event: "Stop", command: "" },
          { event: "UserPromptSubmit", command: ["node", "-e", "0"], timeoutMs: 500 },
        ],
      }),
    );
    const result = await loadHookRegistrations(file);
    expect(result.registrations).toHaveLength(2);
    expect(result.errors).toHaveLength(2);
  });

  it("非法 JSON 报错", async () => {
    const file = join(root, "hooks.json");
    await writeFile(file, "{ 这不是 JSON");
    expect((await loadHookRegistrations(file)).errors).toHaveLength(1);
  });
});

describe("子进程执行", () => {
  describe("runHook", () => {
    it("递 stdin、收 stdout 决定", async () => {
      const registration: HookRegistration = {
        event: "PreToolUse",
        command: nodeHook(
          "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const i=JSON.parse(d);process.stdout.write(JSON.stringify({decision:i.toolName==='bash'?'deny':'allow',reason:'from-hook'}))})",
        ),
      };
      const result = await runHook(registration, baseInput);
      expect(result.error).toBeUndefined();
      expect(result.output).toEqual({ decision: "deny", reason: "from-hook" });
    });

    it("超时记为无决定并带错误", async () => {
      const registration: HookRegistration = {
        event: "PreToolUse",
        command: nodeHook("process.stdin.resume();setTimeout(()=>{},10000)"),
        timeoutMs: 200,
      };
      const result = await runHook(registration, baseInput);
      expect(result.output).toBeNull();
      expect(result.error).toContain("超时");
    });

    it("非零退出记为无决定（写坏的钩子不该放行也不该卡死）", async () => {
      const registration: HookRegistration = {
        event: "PreToolUse",
        command: nodeHook("process.exit(3)"),
      };
      const result = await runHook(registration, baseInput);
      expect(result.output).toBeNull();
      expect(result.error).toContain("退出码 3");
    });
  });

  describe("runHooks", () => {
    it("runHooks 只跑匹配的钩子并合并", async () => {
      const calls: string[] = [];
      const registrations: HookRegistration[] = [
        {
          event: "PreToolUse",
          matcher: "bash",
          command: nodeHook(
            `require('fs').appendFileSync(${JSON.stringify(join(root, "a.log"))},'a');process.stdin.resume();process.stdin.on('end',()=>process.stdout.write('{"decision":"ask","reason":"需确认"}'))`,
          ),
        },
        {
          event: "PreToolUse",
          matcher: "write",
          command: nodeHook("process.exit(0)"),
        },
      ];
      void calls;
      const merged = await runHooks(registrations, "PreToolUse", "bash", () => baseInput);
      expect(merged.decision).toBe("ask");
      expect(await readFile(join(root, "a.log"), "utf8")).toBe("a"); // 只有匹配的钩子跑了
    });
  });
});
