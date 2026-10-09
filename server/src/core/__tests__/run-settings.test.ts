/** core/run-settings：从会话条目里取最后一条运行参数（打开会话时用它校准 app.db） */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { MODE_RECORD_CUSTOM_TYPE } from "@ucode/contracts";

import { lastRunSettingsOf } from "../run-settings";

const modeEntry = (id: string, data: unknown): SessionEntry => ({
  type: "custom",
  id,
  parentId: null,
  timestamp: "2026-01-01T00:00:00.000Z",
  customType: MODE_RECORD_CUSTOM_TYPE,
  data,
});

/** 夹在设置点之间的普通条目：取最后一条时不能被它们干扰 */
const messageEntry = (id: string): SessionEntry =>
  ({
    type: "message",
    id,
    parentId: null,
    timestamp: "2026-01-01T00:00:00.000Z",
    message: { role: "user", content: [{ type: "text", text: "hi" }], timestamp: 1 },
  }) as unknown as SessionEntry;

describe("lastRunSettingsOf", () => {
  it("取最后一条设置点，两个字段都带出来", () => {
    assert.deepEqual(
      lastRunSettingsOf([
        modeEntry("m1", { mode: "build", permissionMode: "default", at: "t" }),
        messageEntry("u1"),
        modeEntry("m2", { mode: "plan", permissionMode: "auto", at: "t" }),
      ]),
      { mode: "plan", permissionMode: "auto" },
    );
  });

  it("只切了一个字段时只带那一个", () => {
    assert.deepEqual(lastRunSettingsOf([modeEntry("m1", { permissionMode: "full", at: "t" })]), {
      permissionMode: "full",
    });
  });

  it("没有设置点（老会话）时返回 null", () => {
    assert.equal(lastRunSettingsOf([messageEntry("u1")]), null);
    assert.equal(lastRunSettingsOf([]), null);
  });

  it("形状损坏的那条跳过，继续往前找", () => {
    assert.deepEqual(
      lastRunSettingsOf([modeEntry("m1", { mode: "ask", at: "t" }), modeEntry("m2", { at: "t" })]),
      { mode: "ask" },
    );
  });
});
