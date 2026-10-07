/** core/serialize：消息区块与界面标记条目的投影 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";

import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import {
  API_BASE_PATH,
  PERMISSION_DECISION_CUSTOM_TYPE,
  PLAN_IGNORED_CUSTOM_TYPE,
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

  it("其它 customType 的扩展条目不展示", () => {
    assert.equal(entryToDTO(customEntry("other.extension")), null);
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
