/** MCP 权限兜底单测：annotations 三态、工具名识别与审批展示文本的截断 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isMcpToolName, mcpPermission, mcpSubject } from "../mcp-rules";

describe("mcpPermission", () => {
  it("声明只读时放行", () => {
    assert.equal(mcpPermission({ readOnlyHint: true }).action, "allow");
  });

  it("可能删除 / 覆盖时审批", () => {
    const verdict = mcpPermission({ destructiveHint: true });
    assert.equal(verdict.action, "ask");
    assert.match(verdict.note, /删除或覆盖/);
  });

  it("访问外部环境时审批", () => {
    assert.equal(mcpPermission({ openWorldHint: true }).action, "ask");
  });

  it("没有 annotations 时按可能写处理", () => {
    assert.equal(mcpPermission(undefined).action, "ask");
    assert.equal(mcpPermission({}).action, "ask");
  });

  it("只读优先于其它提示", () => {
    assert.equal(mcpPermission({ readOnlyHint: true, destructiveHint: true }).action, "allow");
  });
});

describe("isMcpToolName", () => {
  it("只认 mcp__ 前缀", () => {
    assert.equal(isMcpToolName("mcp__fs__read_file"), true);
    assert.equal(isMcpToolName("read"), false);
    assert.equal(isMcpToolName("mcp_read"), false);
  });
});

describe("mcpSubject", () => {
  it("拼入参摘要与原因", () => {
    const subject = mcpSubject({ path: "/tmp/a" }, "可能产生副作用");
    assert.match(subject, /"path":"\/tmp\/a"/);
    assert.match(subject, /可能产生副作用/);
  });

  it("空参数只留原因", () => {
    assert.equal(mcpSubject({}, "可能产生副作用"), "可能产生副作用");
  });

  it("超长摘要被截断", () => {
    const subject = mcpSubject({ data: "x".repeat(500) }, "可能产生副作用");
    assert.ok(subject.length <= 201, `实际长度 ${subject.length}`);
    assert.equal(subject.endsWith("…"), true);
  });
});
