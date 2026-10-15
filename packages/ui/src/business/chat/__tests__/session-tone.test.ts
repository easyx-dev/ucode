/** session-tone：头部状态条的优先级（待审批 > 待填表单 > 生成中）与乐观信号 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { sessionToneOf } from "../session-tone";

describe("sessionToneOf", () => {
  it("三种状态各自成调", () => {
    assert.equal(sessionToneOf("running", false), "busy");
    assert.equal(sessionToneOf("waiting_question", false), "form");
    assert.equal(sessionToneOf("waiting_plan", false), "form");
    assert.equal(sessionToneOf("waiting_permission", false), "permission");
  });

  it("优先级与服务端同序：等用户的状态压过生成中", () => {
    assert.equal(sessionToneOf("waiting_permission", true), "permission");
    assert.equal(sessionToneOf("waiting_question", true), "form");
  });

  it("空闲与出错不给底色", () => {
    assert.equal(sessionToneOf("idle", false), null);
    assert.equal(sessionToneOf("error", false), null);
  });

  it("状态还没跟上时按本端在接流显示生成中", () => {
    assert.equal(sessionToneOf("idle", true), "busy");
    assert.equal(sessionToneOf("error", true), "busy");
  });
});
