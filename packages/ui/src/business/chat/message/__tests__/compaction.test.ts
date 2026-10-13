/**
 * 压缩分隔行的文案单测：成功报「对话已压缩」并带上触发与规模，跳过 / 失败说清原因。
 *
 * 提示与分隔行共用同一套原因文案（服务端只给原因枚举），所以这里也顺带盯住提示那一侧。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { CompactionNotice, CompactionRecord } from "@ucode/contracts";
import type { TFunction } from "i18next";

import { compactionLineDetail, compactionLineText, compactionNoticeMessage } from "../compaction";

/** 替身 t：缺 key 时回退为 key 本身并插值，断言看的就是界面上真正出现的中文 */
const translate = ((key: string, options?: Record<string, unknown>) =>
  options
    ? key.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options[name]))
    : key) as unknown as TFunction;

const recordOf = (patch: Partial<CompactionRecord> = {}): CompactionRecord => ({
  reason: "threshold",
  outcome: "done",
  at: "2026-01-01T00:00:00.000Z",
  ...patch,
});

describe("压缩分隔行的文案", () => {
  it("成功：触发来源与规模都带上", () => {
    assert.equal(compactionLineText(recordOf(), translate), "对话已压缩");
    assert.equal(
      compactionLineDetail(recordOf({ tokensBefore: 12_300, tokensAfter: 4_100 }), translate),
      "达阈值 · 12.3k → 4.1k",
    );
    assert.equal(
      compactionLineDetail(recordOf({ reason: "manual" }), translate),
      "手动",
      "拿不到规模时只报来源",
    );
    assert.equal(compactionLineDetail(recordOf({ reason: "overflow" }), translate), "超窗口");
  });

  it("跳过：两种原因各一句，与提示同口径", () => {
    const tooSmall = recordOf({ reason: "manual", outcome: "skipped", skip: "too_small" });
    const already = recordOf({ reason: "manual", outcome: "skipped", skip: "already_compacted" });

    assert.equal(compactionLineText(tooSmall, translate), "当前上下文已经很紧凑，无需压缩");
    assert.equal(
      compactionLineText(already, translate),
      "当前上下文已经是压缩后的状态，无需重复压缩",
    );
    assert.equal(compactionLineDetail(tooSmall, translate), null, "没压成就不报规模");

    const notice: CompactionNotice = { kind: "skipped", reason: "too_small" };
    assert.equal(
      compactionNoticeMessage(notice, translate),
      compactionLineText(tooSmall, translate),
    );
  });

  it("失败：把 pi 的原始原因带出来；没有记录（旧数据）就只说压缩过", () => {
    assert.equal(
      compactionLineText(
        recordOf({ reason: "overflow", outcome: "failed", error: "上游超时" }),
        translate,
      ),
      "压缩失败：上游超时",
    );
    assert.equal(
      compactionLineText(recordOf({ outcome: "failed" }), translate),
      "压缩失败：未知原因",
    );
    assert.equal(compactionLineText(undefined, translate), "对话已压缩");
    assert.equal(compactionLineDetail(undefined, translate), null);
  });
});
