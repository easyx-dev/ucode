/**
 * 观测记录写入的单测：池里在跑时用手上的 manager，已回收时按 source_path 打开文件。
 *
 * 后者是新会话最容易踩的地方——`ensure()` 抓到的那份快照里 `source_path` 还可能是空的，
 * 照它判断会把正要用的记录整条丢掉（真机验证里 `SUBAGENT_RECORD_CUSTOM_TYPE` 就是这么丢的）。
 */
import assert from "node:assert/strict";
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import type { SessionManager } from "@earendil-works/pi-coding-agent";

import type { SessionRecord } from "../../db/session-repository";
import { appendSessionRecord } from "../records";

const CUSTOM_TYPE = "probe.record";

const recordOf = (sourcePath: string | null): SessionRecord =>
  ({
    id: "s1",
    cwd: "/tmp/project",
    sourcePath,
    parentSessionId: null,
    agent: null,
    createdAt: "2026-01-01T00:00:00.000Z",
  }) as unknown as SessionRecord;

const fakeLive = (writes: Array<{ customType: string; data: unknown }>): SessionManager =>
  ({
    appendCustomEntry: (customType: string, data: unknown) => {
      writes.push({ customType, data });
      return `e${writes.length}`;
    },
  }) as unknown as SessionManager;

describe("appendSessionRecord", () => {
  it("池里有活会话时走它手上的 manager，不看 source_path", () => {
    const writes: Array<{ customType: string; data: unknown }> = [];
    appendSessionRecord(recordOf(null), CUSTOM_TYPE, { at: "t" }, fakeLive(writes));
    assert.deepEqual(writes, [{ customType: CUSTOM_TYPE, data: { at: "t" } }]);
  });

  it("没有活会话也没有 source_path 时静默跳过", () => {
    // 不能抛：观测记录不该把主流程带崩
    appendSessionRecord(recordOf(null), CUSTOM_TYPE, { at: "t" });
  });

  it("已回收的会话按 source_path 追加到文件末尾", () => {
    const dir = mkdtempSync(join(tmpdir(), "session-records-"));
    const path = join(dir, "session.jsonl");
    const header = {
      type: "session",
      version: 3,
      id: "s1",
      timestamp: "2026-01-01T00:00:00.000Z",
      cwd: "/tmp/project",
    };
    const write = (text: string): void => {
      // 新文件由会话头起步，之后的追加由被测代码完成
      appendFileSync(path, `${text}\n`, "utf8");
    };
    write(JSON.stringify(header));

    try {
      appendSessionRecord(recordOf(path), CUSTOM_TYPE, { at: "t" });
      const lines = readFileSync(path, "utf8").trim().split("\n");
      assert.equal(lines.length, 2, "应追加一条");
      const entry = JSON.parse(lines[1] ?? "{}");
      assert.equal(entry.type, "custom");
      assert.equal(entry.customType, CUSTOM_TYPE);
      assert.deepEqual(entry.data, { at: "t" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
