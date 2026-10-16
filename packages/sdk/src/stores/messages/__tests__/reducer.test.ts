/**
 * 消息归并的幂等性：同一条权威消息重复到达时只落一条。
 *
 * 帧重复送达、以及「快照已含这条、帧才到」两种情形都会让同一条消息进来两次，
 * 归并层自己得认得出——只靠「找最后一条 live」找落点，落空就会把它追加成第二条。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { MessageDTO } from "@ucode/contracts";

import type { ChatItem } from "../../../types";
import { mergeMessage, reduceEvent } from "../reducer";

const userMessage = (id: string): MessageDTO =>
  ({ id, role: "user", blocks: [{ type: "text", text: "看图" }] }) as MessageDTO;

const toolMessage = (id: string, toolCallId: string): MessageDTO =>
  ({
    id,
    role: "tool",
    blocks: [{ type: "text", text: "结果" }],
    toolCallId,
    toolName: "read",
  }) as MessageDTO;

const liveUser = (id: string, uid: string): ChatItem => ({
  id,
  uid,
  role: "user",
  blocks: [{ type: "text", text: "看图" }],
  live: true,
  createdAt: "2024-01-01T00:00:00.000Z",
});

describe("消息归并 · 同一 entry 只落一条", () => {
  it("没有乐观条目时重复到达也不追加第二条", () => {
    const once = mergeMessage([], userMessage("entry-1"));
    const twice = mergeMessage(once, userMessage("entry-1"));

    assert.equal(twice.length, 1);
    assert.equal(twice[0]?.id, "entry-1");
  });

  it("乐观条目已被权威版本替换后，同一条再来一遍仍是一条", () => {
    const merged = mergeMessage([liveUser("live-user-1", "live-user-1")], userMessage("entry-1"));
    const again = mergeMessage(merged, userMessage("entry-1"));

    assert.equal(again.length, 1);
    // uid 沿用乐观条目的那份：行 key 不因这次重复而变，界面不会看见行重建
    assert.equal(again[0]?.uid, "live-user-1");
    assert.equal(again[0]?.live, false);
  });

  it("工具结果重复到达按条目 id 收敛，不再多出一张卡片", () => {
    const started = reduceEvent([], "tool_start", { toolCallId: "call-1", toolName: "read" });
    const once = reduceEvent(started, "message_end", toolMessage("entry-2", "call-1"));
    const twice = reduceEvent(once, "message_end", toolMessage("entry-2", "call-1"));

    assert.equal(twice.length, 1);
    assert.equal(twice[0]?.id, "entry-2");
  });
});
