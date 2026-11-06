/** services/cli/doctor：自检结果的文本与 JSON 呈现 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { type DoctorCheck, renderDoctor, renderDoctorJson } from "..";
import { displayWidth } from "../doctor";

const checks: DoctorCheck[] = [
  { name: "Node 版本", level: "ok", detail: "24.0.0" },
  { name: "服务注册", level: "fail", detail: "没有 service.json", hint: "先启动一次" },
  { name: "模型配置", level: "warn", detail: "providers 为空" },
];

describe("renderDoctor", () => {
  it("逐项给出结论，失败项附修复建议", () => {
    const text = renderDoctor({ checks, hasFailure: true });
    assert.ok(text.includes("Node 版本"));
    assert.ok(text.includes("fail"));
    assert.ok(text.includes("→ 先启动一次"));
  });

  it("中文检查项按显示宽度对齐：说明列起始于同一显示列", () => {
    const rows = renderDoctor({
      checks: [
        { name: "Node 版本", level: "ok", detail: "detail-a" },
        { name: "x", level: "ok", detail: "detail-b" },
        { name: "很长很长的检查项", level: "warn", detail: "detail-c" },
      ],
      hasFailure: false,
    })
      .split("\n")
      .filter((line) => line.includes("detail-"));

    assert.equal(rows.length, 3);
    const columns = rows.map((row) => displayWidth(row.slice(0, row.indexOf("detail-"))));
    assert.equal(new Set(columns).size, 1, `说明列没对齐：${columns.join(" / ")}`);
  });

  it("汇总分别报未通过与提示的数量", () => {
    const text = renderDoctor({ checks, hasFailure: true });
    assert.ok(text.includes("1 项未通过"));
    assert.ok(text.includes("1 项提示"));
  });

  it("全部通过时给出通过结论", () => {
    const text = renderDoctor({ checks: [checks[0] as DoctorCheck], hasFailure: false });
    assert.ok(text.includes("自检通过"));
    assert.equal(text.includes("未通过"), false);
  });
});

describe("renderDoctorJson", () => {
  it("带版本、平台与整体结论，便于贴给维护者", () => {
    const parsed = JSON.parse(renderDoctorJson({ checks, hasFailure: true })) as Record<
      string,
      unknown
    >;
    assert.equal(parsed.ok, false);
    assert.equal(typeof parsed.version, "string");
    assert.equal(Array.isArray(parsed.checks), true);
    assert.equal((parsed.checks as DoctorCheck[]).length, checks.length);
  });
});
