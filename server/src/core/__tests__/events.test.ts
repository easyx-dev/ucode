/**
 * 压缩事件的对外映射单测：压缩前后规模只在成功时透出，失败由 error 帧承担。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";

import { toSseEvents } from "../events";

/** pi 的事件是判别联合，用例只关心被映射的那几个字段，构造时按契约补齐形状 */
const piEvent = (value: unknown): AgentSessionEvent => value as AgentSessionEvent;

describe("压缩事件的映射", () => {
  it("compaction_start 只带 reason", () => {
    assert.deepEqual(toSseEvents(piEvent({ type: "compaction_start", reason: "manual" })), [
      { event: "compaction_start", data: { reason: "manual" } },
    ]);
  });

  it("compaction_end 透出压缩前后的规模，摘要正文不在事件里重复", () => {
    const result = {
      summary: "## Goal\n继续做某事",
      firstKeptEntryId: "e9",
      tokensBefore: 120_000,
      estimatedTokensAfter: 18_000,
      usage: { input: 900, output: 120, cacheRead: 0, cacheWrite: 0 },
      details: { readFiles: [], modifiedFiles: [] },
    };

    assert.deepEqual(
      toSseEvents(piEvent({ type: "compaction_end", reason: "manual", result, aborted: false })),
      [
        {
          event: "compaction_end",
          data: { reason: "manual", tokensBefore: 120_000, estimatedTokensAfter: 18_000 },
        },
      ],
    );
  });

  it("压缩失败（没有 result）时不透出规模字段", () => {
    assert.deepEqual(
      toSseEvents(
        piEvent({
          type: "compaction_end",
          reason: "manual",
          aborted: true,
        }),
      ),
      [{ event: "compaction_end", data: { reason: "manual" } }],
    );
  });

  it("失败时带 pi 的原因：自动压缩失败没有别的通道，不带给客户端就只能等下一轮超窗", () => {
    assert.deepEqual(
      toSseEvents(
        piEvent({
          type: "compaction_end",
          reason: "threshold",
          aborted: false,
          errorMessage: "Auto-compaction failed: upstream 500",
        }),
      ),
      [
        {
          event: "compaction_end",
          data: { reason: "threshold", errorMessage: "Auto-compaction failed: upstream 500" },
        },
      ],
    );
  });
});

describe("message_end 的条目 id", () => {
  const userMessage = () => ({ role: "user", content: [{ type: "text", text: "看这个" }] });

  it("调用方补了条目 id 就用它（界面拿这个 id 做编辑 / 分叉）", () => {
    const frames = toSseEvents(
      piEvent({ type: "message_end", message: userMessage() }),
      {},
      { messageEntryId: "e7f1" },
    );

    assert.equal(frames[0]?.event, "message_end");
    assert.equal(frames[0]?.data.id, "e7f1");
  });

  it("没补时退回可辨认的临时 id，不假装是条目 id", () => {
    const frames = toSseEvents(piEvent({ type: "message_end", message: userMessage() }));

    assert.match(String(frames[0]?.data.id), /^live-\d+-[0-9a-f]+$/);
  });
});
