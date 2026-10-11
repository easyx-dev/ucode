/** harness/pi/serialize：消息区块与界面标记条目的投影 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";

import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import {
  API_BASE_PATH,
  COMPACTION_RECORD_CUSTOM_TYPE,
  GOAL_PROMPT_CUSTOM_TYPE,
  GOAL_RECORD_CUSTOM_TYPE,
  PERMISSION_DECISION_CUSTOM_TYPE,
  PLAN_IGNORED_CUSTOM_TYPE,
  RETRY_RECORD_CUSTOM_TYPE,
  SKILL_RECORD_CUSTOM_TYPE,
} from "@ucode/contracts";

import { blocksOf, entriesToDTO, entryToDTO } from "../serialize";

describe("blocksOf 的 image 分支", () => {
  it("投影为 { id, mimeType, url }，id 与附件库的 sha256 一致", () => {
    const data = Buffer.from("abc").toString("base64");
    const id = createHash("sha256").update(Buffer.from(data, "base64")).digest("hex");

    assert.deepEqual(blocksOf([{ type: "image", data, mimeType: "image/png" }]), [
      { type: "image", id, mimeType: "image/png", url: `${API_BASE_PATH}/attachments/${id}` },
    ]);
  });

  it("缺 data 时回落为文字占位", () => {
    assert.deepEqual(blocksOf([{ type: "image", mimeType: "image/png" }]), [
      { type: "text", text: "[图片]" },
    ]);
  });
});

describe("entryToDTO 的 custom 分支", () => {
  const customEntry = (customType: string, data?: unknown): SessionEntry => ({
    type: "custom",
    id: "entry-1",
    parentId: null,
    timestamp: "2026-01-01T00:00:00.000Z",
    customType,
    data: data ?? { at: "2026-01-01T00:00:00.000Z" },
  });

  it("忽略计划的标记投影为 role custom + customType，且无正文", () => {
    assert.deepEqual(entryToDTO(customEntry(PLAN_IGNORED_CUSTOM_TYPE)), {
      id: "entry-1",
      role: "custom",
      blocks: [],
      customType: PLAN_IGNORED_CUSTOM_TYPE,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
  });

  it("审批记录投影为带 permissionDecision 的 custom 条目", () => {
    const data = {
      tool: "bash",
      subject: "git push origin main",
      scope: "bash(git push *)",
      decision: "allow_session",
      sourceSessionId: "sub-1",
      sourceDescription: "侦察影响面",
    };

    assert.deepEqual(entryToDTO(customEntry(PERMISSION_DECISION_CUSTOM_TYPE, data)), {
      id: "entry-1",
      role: "custom",
      blocks: [],
      customType: PERMISSION_DECISION_CUSTOM_TYPE,
      permissionDecision: data,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
  });

  it("审批记录缺来源时不下发来源字段（主会话自身发起的审批就是这种）", () => {
    const dto = entryToDTO(
      customEntry(PERMISSION_DECISION_CUSTOM_TYPE, {
        tool: "read",
        subject: "/etc/hosts",
        scope: "/etc/**",
        decision: "allow_once",
      }),
    );

    assert.deepEqual(dto?.permissionDecision, {
      tool: "read",
      subject: "/etc/hosts",
      scope: "/etc/**",
      decision: "allow_once",
    });
  });

  it("审批记录字段缺失或决定值非法时整条不展示", () => {
    const invalid = [
      { tool: "bash", subject: "x", scope: "y" },
      { tool: "bash", subject: "x", scope: "y", decision: "maybe" },
      { tool: 1, subject: "x", scope: "y", decision: "deny" },
    ];

    for (const data of invalid) {
      assert.equal(entryToDTO(customEntry(PERMISSION_DECISION_CUSTOM_TYPE, data)), null);
    }
  });

  it("目标记录带上 goalRecord，事件不合法时整条不展示", () => {
    const data = {
      event: "completed",
      status: "completed",
      turns: 2,
      verdict: { achieved: true, reason: "测试全绿", nextStep: "" },
      tokensUsed: 1234,
      at: "2026-01-01T00:00:00.000Z",
    };
    assert.deepEqual(entryToDTO(customEntry(GOAL_RECORD_CUSTOM_TYPE, data)), {
      id: "entry-1",
      role: "custom",
      blocks: [],
      customType: GOAL_RECORD_CUSTOM_TYPE,
      goalRecord: data,
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    assert.equal(entryToDTO(customEntry(GOAL_RECORD_CUSTOM_TYPE, { event: "?", at: "x" })), null);
  });

  it("合成输入带出 customType 与来源（目标注入的 kind / turn）", () => {
    const entry: SessionEntry = {
      type: "custom_message",
      id: "entry-2",
      parentId: null,
      timestamp: "2026-01-01T00:00:00.000Z",
      customType: GOAL_PROMPT_CUSTOM_TYPE,
      content: "目标：把 TODO 做完",
      display: true,
      details: { kind: "continuation", turn: 3 },
    };
    assert.deepEqual(entryToDTO(entry), {
      id: "entry-2",
      role: "custom",
      blocks: [{ type: "text", text: "目标：把 TODO 做完" }],
      customType: GOAL_PROMPT_CUSTOM_TYPE,
      goalPrompt: { kind: "continuation", turn: 3 },
      createdAt: "2026-01-01T00:00:00.000Z",
    });
  });

  it("其它 customType 的扩展条目不展示", () => {
    assert.equal(entryToDTO(customEntry("other.extension")), null);
  });

  it("压缩记录投影为带 compactionRecord 的 custom 条目", () => {
    const at = "2026-01-01T00:00:00.000Z";
    const data = {
      reason: "threshold",
      outcome: "done",
      tokensBefore: 12_300,
      tokensAfter: 4_100,
      keptFrom: "entry-9",
      at,
    };
    const dto = entryToDTO(customEntry(COMPACTION_RECORD_CUSTOM_TYPE, data));

    assert.deepEqual(dto, {
      id: "entry-1",
      role: "custom",
      blocks: [],
      customType: COMPACTION_RECORD_CUSTOM_TYPE,
      compactionRecord: data,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
  });

  it("压缩记录的触发来源或结局非法时整条不展示，缺可选字段照常带上", () => {
    assert.equal(
      entryToDTO(
        customEntry(COMPACTION_RECORD_CUSTOM_TYPE, { reason: "?", outcome: "done", at: "x" }),
      ),
      null,
    );
    assert.equal(
      entryToDTO(
        customEntry(COMPACTION_RECORD_CUSTOM_TYPE, { reason: "manual", outcome: "?", at: "x" }),
      ),
      null,
    );
    assert.equal(
      entryToDTO(
        customEntry(COMPACTION_RECORD_CUSTOM_TYPE, { reason: "manual", outcome: "skipped" }),
      ),
      null,
    );

    const skipped = entryToDTO(
      customEntry(COMPACTION_RECORD_CUSTOM_TYPE, {
        reason: "manual",
        outcome: "skipped",
        skip: "too_small",
        at: "2026-01-01T00:00:00.000Z",
      }),
    );
    assert.deepEqual(skipped?.compactionRecord, {
      reason: "manual",
      outcome: "skipped",
      skip: "too_small",
      at: "2026-01-01T00:00:00.000Z",
    });
  });
});

describe("entryToDTO 的技能记录", () => {
  const customEntry = (data: unknown): SessionEntry => ({
    type: "custom",
    id: "entry-1",
    parentId: null,
    timestamp: "2026-01-01T00:00:00.000Z",
    customType: SKILL_RECORD_CUSTOM_TYPE,
    data,
  });

  it("命中投影为带 skillRecord 的 custom 条目", () => {
    const data = {
      event: "hit",
      name: "lark-base",
      file: "/repo/.agents/skills/lark-base/SKILL.md",
      source: "project",
      toolCallId: "call-1",
      at: "2026-01-01T00:00:00.000Z",
    };

    assert.deepEqual(entryToDTO(customEntry(data)), {
      id: "entry-1",
      role: "custom",
      blocks: [],
      customType: SKILL_RECORD_CUSTOM_TYPE,
      skillRecord: data,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
  });

  it("显式调用不下发：用户消息上的 chip 已经表达过这件事", () => {
    const dto = entryToDTO(
      customEntry({
        event: "invoke",
        name: "review",
        file: "/repo/.agents/skills/review/SKILL.md",
        source: "project",
        at: "2026-01-01T00:00:00.000Z",
      }),
    );

    assert.equal(dto, null);
  });

  it("形状不对时不下发：缺名字 / 路径、event 或 source 越界都当没有记录", () => {
    assert.equal(
      entryToDTO(customEntry({ event: "hit", source: "project", at: "2026-01-01T00:00:00.000Z" })),
      null,
    );
    assert.equal(
      entryToDTO(
        customEntry({
          event: "nope",
          name: "x",
          file: "/f",
          source: "project",
          at: "2026-01-01T00:00:00.000Z",
        }),
      ),
      null,
    );
    assert.equal(
      entryToDTO(
        customEntry({
          event: "hit",
          name: "x",
          file: "/f",
          source: "nope",
          at: "2026-01-01T00:00:00.000Z",
        }),
      ),
      null,
    );
  });
});

describe("entryToDTO 的重试记录", () => {
  const customEntry = (data: unknown): SessionEntry => ({
    type: "custom",
    id: "entry-1",
    parentId: null,
    timestamp: "2026-01-01T00:00:00.000Z",
    customType: RETRY_RECORD_CUSTOM_TYPE,
    data,
  });

  it("准备重试时下发，带上次数与等待时长", () => {
    const data = {
      event: "start",
      attempt: 1,
      maxAttempts: 5,
      delayMs: 2000,
      errorMessage: "fetch failed",
      at: "2026-01-01T00:00:00.000Z",
    };

    assert.deepEqual(entryToDTO(customEntry(data)), {
      id: "entry-1",
      role: "custom",
      blocks: [],
      customType: RETRY_RECORD_CUSTOM_TYPE,
      retryRecord: data,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
  });

  it("重试成功不下发：紧接着就是正常输出，界面多一行是噪音", () => {
    const dto = entryToDTO(
      customEntry({
        event: "end",
        attempt: 2,
        maxAttempts: 5,
        success: true,
        at: "2026-01-01T00:00:00.000Z",
      }),
    );

    assert.equal(dto, null);
  });

  it("最终失败下发，带上上游的错误文本", () => {
    const dto = entryToDTO(
      customEntry({
        event: "end",
        attempt: 5,
        maxAttempts: 5,
        success: false,
        errorMessage: "stream ended before message_stop",
        at: "2026-01-01T00:00:00.000Z",
      }),
    );

    assert.equal(dto?.retryRecord?.success, false);
    assert.equal(dto?.retryRecord?.errorMessage, "stream ended before message_stop");
  });

  it("形状不对时不下发：event 越界、attempt 不是数字、缺 at 都当没有记录", () => {
    const base = { attempt: 1, maxAttempts: 5, at: "2026-01-01T00:00:00.000Z" };

    assert.equal(entryToDTO(customEntry({ ...base, event: "nope" })), null);
    assert.equal(entryToDTO(customEntry({ ...base, event: "start", attempt: "1" })), null);
    assert.equal(entryToDTO(customEntry({ event: "start", attempt: 1, maxAttempts: 5 })), null);
  });
});

describe("entriesToDTO 的压缩条目", () => {
  const compactionEntry = (id: string): SessionEntry => ({
    type: "compaction",
    id,
    parentId: null,
    timestamp: "2026-01-01T00:00:00.000Z",
    summary: `摘要 ${id}`,
    firstKeptEntryId: "entry-1",
    tokensBefore: 100,
  });

  const userEntry = (id: string): SessionEntry => ({
    type: "message",
    id,
    parentId: null,
    timestamp: "2026-01-01T00:00:00.000Z",
    message: {
      role: "user",
      content: [{ type: "text", text: "问一句" }],
      timestamp: 1767225600000,
    },
  });

  it("只下发最新一次压缩的分隔标记：最新那条在首位，更早的落在外层保留区间里", () => {
    // 顺序即 pi 的 buildContextEntries() 输出：最新压缩条目在前，更早的压缩跟在保留区间里
    const entries = [
      compactionEntry("c2"),
      userEntry("u1"),
      compactionEntry("c1"),
      userEntry("u2"),
    ];

    const ids = entriesToDTO(entries, new Map()).map((dto) => `${dto.role}:${dto.id}`);
    assert.deepEqual(ids, ["summary:c2", "user:u1", "user:u2"]);
  });

  it("只压缩过一次时照常下发", () => {
    const ids = entriesToDTO([compactionEntry("c1"), userEntry("u1")], new Map()).map(
      (dto) => `${dto.role}:${dto.id}`,
    );
    assert.deepEqual(ids, ["summary:c1", "user:u1"]);
  });
});
