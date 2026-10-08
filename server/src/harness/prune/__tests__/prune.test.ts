/**
 * 旧工具输出清理单测：保护窗口、批量阈值、工具豁免与幂等。
 *
 * 全部在内存会话里造条目，不落盘、不依赖模型。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SessionManager } from "@earendil-works/pi-coding-agent";

import { PRUNE_MIN_CLEARED_TOKENS, PRUNE_PLACEHOLDER } from "../../../constants";
import { pruneToolOutputs } from "../index";

const manager = (): SessionManager => SessionManager.inMemory("/tmp/prune-project");

const appendUser = (target: SessionManager, text: string): void => {
  target.appendMessage({ role: "user", content: [{ type: "text", text }], timestamp: Date.now() });
};

const appendAssistant = (target: SessionManager): void => {
  target.appendMessage({
    role: "assistant",
    api: "openai-completions",
    provider: "p",
    model: "m",
    content: [{ type: "text", text: "ok" }],
    stopReason: "stop",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    timestamp: Date.now(),
  });
};

const appendToolResult = (
  target: SessionManager,
  input: { toolName: string; chars: number },
): string =>
  target.appendMessage({
    role: "toolResult",
    toolCallId: `call-${input.toolName}-${input.chars}`,
    toolName: input.toolName,
    content: [{ type: "text", text: "x".repeat(input.chars) }],
    isError: false,
    timestamp: Date.now(),
  });

/** 一轮用户消息 + 一条回复 + 该轮的工具结果 */
const turn = (
  target: SessionManager,
  label: string,
  results: Array<{ toolName: string; chars: number }>,
): string[] => {
  appendUser(target, label);
  appendAssistant(target);
  return results.map((result) => appendToolResult(target, result));
};

const editsOf = (target: SessionManager): string[] =>
  target
    .getBranch()
    .flatMap((entry) => (entry.type === "context_edit" ? [String(entry.targetId)] : []));

/** 400k 字符 ≈ 100k token：够把 40k 的保护窗口一次用光 */
const BIG_CHARS = 400_000;

describe("旧工具输出清理", () => {
  it("清掉保护窗口之外的旧结果，保留消息本身只换正文", () => {
    const target = manager();
    const old = turn(target, "第一轮", [{ toolName: "read", chars: BIG_CHARS }]);
    turn(target, "第二轮", [{ toolName: "read", chars: BIG_CHARS }]);
    turn(target, "第三轮", [{ toolName: "read", chars: 200 }]);
    turn(target, "第四轮", [{ toolName: "read", chars: 200 }]);

    const outcome = pruneToolOutputs(target);
    assert.equal(outcome.cleared, 1);
    assert.ok(outcome.freedTokens >= PRUNE_MIN_CLEARED_TOKENS);

    const edits = editsOf(target);
    assert.deepEqual(edits, [old[0] ?? ""]);
    // 原始条目没被改写：清理只影响模型上下文，历史与账目不受影响
    const entry = target.getEntry(old[0] ?? "");
    assert.equal(entry?.type, "message");
    assert.equal(JSON.stringify(entry).includes(PRUNE_PLACEHOLDER), false);
    assert.equal(target.getBranch().at(-1)?.type, "context_edit");
  });

  it("清出的量不到阈值就不动，避免碎片式清理反复打断前缀缓存", () => {
    const target = manager();
    // 第一轮的结果很小，但它已经是「两轮之外、40k 之外」的唯一候选
    turn(target, "第一轮", [{ toolName: "read", chars: 16_000 }]);
    turn(target, "第二轮", [{ toolName: "read", chars: BIG_CHARS }]);
    turn(target, "第三轮", [{ toolName: "read", chars: 200 }]);
    turn(target, "第四轮", [{ toolName: "read", chars: 200 }]);

    const outcome = pruneToolOutputs(target);
    assert.equal(outcome.cleared, 0);
    assert.equal(outcome.freedTokens, 0);
    assert.equal(editsOf(target).length, 0);
  });

  it("最近两轮的工具输出受保护，不动", () => {
    const target = manager();
    turn(target, "第一轮", [{ toolName: "read", chars: BIG_CHARS }]);
    turn(target, "第二轮", [{ toolName: "read", chars: BIG_CHARS }]);

    assert.equal(pruneToolOutputs(target).cleared, 0);
  });

  it("结论型工具（subagent / edit / write）永不被清", () => {
    const target = manager();
    turn(target, "第一轮", [
      { toolName: "subagent", chars: 200_000 },
      { toolName: "edit", chars: 200_000 },
    ]);
    turn(target, "第二轮", [{ toolName: "read", chars: 200 }]);
    turn(target, "第三轮", [{ toolName: "read", chars: 200 }]);

    assert.equal(pruneToolOutputs(target).cleared, 0);
  });

  it("重复运行不会重复清理同一条", () => {
    const target = manager();
    turn(target, "第一轮", [{ toolName: "read", chars: BIG_CHARS }]);
    turn(target, "第二轮", [{ toolName: "read", chars: BIG_CHARS }]);
    turn(target, "第三轮", [{ toolName: "read", chars: 200 }]);
    turn(target, "第四轮", [{ toolName: "read", chars: 200 }]);

    assert.equal(pruneToolOutputs(target).cleared, 1);
    assert.equal(pruneToolOutputs(target).cleared, 0);
    assert.equal(editsOf(target).length, 1);
  });
});
