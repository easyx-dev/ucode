/**
 * 记忆自动回顾的解析单测：交流摘取与模型输出解析。
 *
 * 回顾本身要真实模型，这里只覆盖不依赖模型的两段纯逻辑——挑消息、判 JSON。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AgentSession } from "@earendil-works/pi-coding-agent";

import { extractExchange, parseReviewDecision, shouldReview } from "../review";

type SessionMessage = AgentSession["messages"][number];

const asMessages = (
  items: Array<{ role: string; content: unknown; stopReason?: string }>,
): SessionMessage[] => items as unknown as SessionMessage[];

describe("shouldReview", () => {
  it("正常结束的轮次可回顾", () => {
    assert.equal(
      shouldReview(
        asMessages([
          { role: "user", content: "问题" },
          { role: "assistant", content: [{ type: "text", text: "回答" }], stopReason: "stop" },
        ]),
      ),
      true,
    );
  });

  it("中断或出错结束的轮次跳过", () => {
    for (const stopReason of ["aborted", "error"]) {
      assert.equal(
        shouldReview(
          asMessages([
            { role: "assistant", content: [{ type: "text", text: "半截" }], stopReason },
          ]),
        ),
        false,
        stopReason,
      );
    }
  });

  it("没有 assistant 回复时不回顾", () => {
    assert.equal(shouldReview(asMessages([{ role: "user", content: "问题" }])), false);
  });
});

describe("extractExchange", () => {
  it("取最近的用户消息与助手回复，按时间正序", () => {
    const turns = extractExchange(
      asMessages([
        { role: "user", content: "第一问" },
        { role: "assistant", content: [{ type: "text", text: "第一答" }] },
        { role: "user", content: "第二问" },
        { role: "assistant", content: [{ type: "text", text: "第二答" }] },
      ]),
    );
    assert.deepEqual(turns, [
      { role: "user", text: "第一问" },
      { role: "assistant", text: "第一答" },
      { role: "user", text: "第二问" },
      { role: "assistant", text: "第二答" },
    ]);
  });

  it("超过轮数上限时只保留最近的若干轮", () => {
    const messages = asMessages([
      { role: "user", content: "旧问" },
      { role: "assistant", content: [{ type: "text", text: "旧答" }] },
      { role: "user", content: "近问" },
      { role: "assistant", content: [{ type: "text", text: "近答" }] },
    ]);
    const turns = extractExchange(messages, 1);
    assert.deepEqual(turns, [
      { role: "user", text: "近问" },
      { role: "assistant", text: "近答" },
    ]);
  });

  it("忽略 thinking / toolCall 等内容块", () => {
    const turns = extractExchange(
      asMessages([
        { role: "assistant", content: [{ type: "thinking", thinking: "内部思考" }] },
        { role: "user", content: "问题" },
      ]),
    );
    assert.deepEqual(turns, [{ role: "user", text: "问题" }]);
  });

  it("最后一轮仍超限时按预算截断，不整条透传", () => {
    const turns = extractExchange(
      asMessages([{ role: "assistant", content: "a".repeat(200) }]),
      3,
      50,
    );
    assert.equal(turns.length, 1);
    assert.equal(turns[0]?.text.length, 50);
  });
});

describe("parseReviewDecision", () => {
  it("接受裸 JSON 与代码块包裹", () => {
    assert.deepEqual(parseReviewDecision('{"remember": false}'), { remember: false });
    assert.deepEqual(
      parseReviewDecision(
        '好的\n```json\n{"remember": true, "title": "偏好", "content": "用 pnpm"}\n```',
      ),
      { remember: true, title: "偏好", content: "用 pnpm" },
    );
  });

  it("结构不符或解析失败按不保存处理", () => {
    assert.equal(parseReviewDecision("没有 JSON"), null);
    assert.equal(parseReviewDecision('{"remember": true}'), null);
    assert.equal(parseReviewDecision('{"remember": true, "title": "", "content": "x"}'), null);
    assert.equal(parseReviewDecision("{坏 JSON}"), null);
  });
});
