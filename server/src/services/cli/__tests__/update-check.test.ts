/** services/cli/update-check：版本比较与三态输出（不联网） */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { compareVersions, renderUpdate, renderUpdateJson, type UpdateCheck } from "..";

describe("compareVersions", () => {
  it("按主次补丁逐段比，字符串序不参与", () => {
    assert.equal(compareVersions("0.10.0", "0.5.0"), 1, "0.10 比 0.5 新");
    assert.equal(compareVersions("1.0.0", "0.99.99"), 1);
    assert.equal(compareVersions("0.5.0", "0.5.0"), 0);
    assert.equal(compareVersions("0.5.1", "0.5.0"), 1);
  });

  it("同版本号的预发布低于正式版", () => {
    assert.equal(compareVersions("0.6.0-beta.1", "0.6.0"), -1);
    assert.equal(compareVersions("0.6.0", "0.6.0-beta.1"), 1);
    assert.equal(compareVersions("0.6.0-beta.2", "0.6.0-beta.1"), 1);
  });

  it("容得下 `v` 前缀，解析不出来时退化成字符串比较", () => {
    assert.equal(compareVersions("v0.6.0", "0.5.0"), 1);
    assert.equal(compareVersions("zzz", "aaa"), 1);
  });
});

describe("renderUpdate", () => {
  const base: UpdateCheck = { current: "0.5.0", latest: "0.5.0", hasUpdate: false };

  it("已是最新时只说版本", () => {
    assert.equal(renderUpdate(base), "已是最新（0.5.0）");
  });

  it("有新版本时给出安装命令与重启提示", () => {
    const text = renderUpdate({ current: "0.5.0", latest: "0.6.0", hasUpdate: true });
    assert.ok(text.includes("0.5.0 → 0.6.0"));
    assert.ok(text.includes("npm install -g"));
    assert.ok(text.includes("restart"));
  });

  it("查询失败时给出原因与手工查法", () => {
    const text = renderUpdate({ ...base, error: "fetch failed" });
    assert.ok(text.includes("fetch failed"));
    assert.ok(text.includes("npm view"));
  });
});

describe("renderUpdateJson", () => {
  it("输出可解析的字段，便于脚本判断", () => {
    const parsed = JSON.parse(
      renderUpdateJson({ current: "0.5.0", latest: "0.6.0", hasUpdate: true }),
    ) as Record<string, unknown>;
    assert.equal(parsed.current, "0.5.0");
    assert.equal(parsed.latest, "0.6.0");
    assert.equal(parsed.hasUpdate, true);
  });
});
