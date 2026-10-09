/** core/run-settings：从会话条目里取最后一条运行参数（打开会话时用它校准 app.db） */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { MODE_RECORD_CUSTOM_TYPE } from "@ucode/contracts";

import { hasRunSettingsChanged, lastRunSettingsOf, runSettingsPatch } from "../run-settings";

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

describe("hasRunSettingsChanged", () => {
  it("两个字段都一致时不记（实例重装后同一份参数也不重复写）", () => {
    assert.equal(
      hasRunSettingsChanged(
        { mode: "build", permissionMode: "full" },
        { mode: "build", permissionMode: "full" },
      ),
      false,
    );
  });

  it("任一字段变了就算变化", () => {
    assert.equal(
      hasRunSettingsChanged(
        { mode: "build", permissionMode: "default" },
        { mode: "plan", permissionMode: "default" },
      ),
      true,
    );
    assert.equal(
      hasRunSettingsChanged(
        { mode: "build", permissionMode: "default" },
        { mode: "build", permissionMode: "full" },
      ),
      true,
    );
  });

  it("没有设置点（老会话）时要记一条起点", () => {
    assert.equal(hasRunSettingsChanged(null, { mode: "build", permissionMode: "default" }), true);
  });

  it("文件里只记了模式时，缺的那侧也算变化", () => {
    assert.equal(
      hasRunSettingsChanged({ mode: "build" }, { mode: "build", permissionMode: "default" }),
      true,
    );
  });
});

describe("runSettingsPatch", () => {
  const known = (): boolean => true;
  const current = { mode: "build", permissionMode: null };

  it("文件与库不一致时两个字段都回写", () => {
    assert.deepEqual(runSettingsPatch({ mode: "plan", permissionMode: "full" }, current, known), {
      mode: "plan",
      permissionMode: "full",
    });
  });

  it("与库里一致时不回写", () => {
    assert.equal(
      runSettingsPatch(
        { mode: "build", permissionMode: "full" },
        { mode: "build", permissionMode: "full" },
        known,
      ),
      null,
    );
  });

  it("未知的模式 slug 不回写：自定义角色可能已被删", () => {
    assert.equal(
      runSettingsPatch({ mode: "ghost" }, current, () => false),
      null,
    );
  });

  it("非法的权限档位不回写：文件可能被手改过", () => {
    assert.equal(runSettingsPatch({ permissionMode: "readonly" }, current, known), null);
  });

  it("没有设置点、或设置点里没有可用的字段时不回写", () => {
    assert.equal(runSettingsPatch(null, current, known), null);
    assert.equal(runSettingsPatch({}, current, known), null);
  });

  it("只有一个字段有差异时只写那一个", () => {
    assert.deepEqual(
      runSettingsPatch({ mode: "ask" }, { mode: "build", permissionMode: "full" }, known),
      { mode: "ask" },
    );
  });
});
