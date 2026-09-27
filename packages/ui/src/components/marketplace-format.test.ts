import type { CatalogEntry, InstalledResource, InstallResult } from "@ucode/sdk";
import { describe, expect, it } from "vitest";
import {
  componentKindLabel,
  describeCatalogEntry,
  groupInstalled,
  summarizeInstallReport,
} from "./marketplace-format.ts";

const resource = (kind: string, name: string): InstalledResource => ({
  kind,
  name,
  path: `/data/${kind}/${name}`,
});

describe("已装资源分组", () => {
  it("按类型分组、组内按名排序、组间稳定", () => {
    const groups = groupInstalled([
      resource("skill", "zeta"),
      resource("extension", "echo"),
      resource("skill", "alpha"),
    ]);
    expect(groups.map((group) => group.kind)).toEqual(["extension", "skill"]);
    expect(groups[1]?.items.map((item) => item.name)).toEqual(["alpha", "zeta"]);
    expect(groups[1]?.label).toBe("技能");
  });

  it("空列表得到空分组", () => {
    expect(groupInstalled([])).toEqual([]);
  });
});

describe("类型标签", () => {
  it("扩展明确标注可执行（装它等于信任来源）", () => {
    expect(componentKindLabel("extension")).toContain("可执行");
    expect(componentKindLabel("agent")).toBe("子智能体");
    expect(componentKindLabel("未知类型")).toBe("未知类型");
  });
});

describe("目录条目描述", () => {
  it("含版本、说明与组件数", () => {
    const entry: CatalogEntry = {
      name: "demo",
      version: "1.2.0",
      description: "演示插件",
      source: "official",
      components: [
        { kind: "skill", name: "pdf", file: "skills/pdf/SKILL.md" },
        { kind: "prompt", name: "review", file: "commands/review.md" },
      ],
    };
    const text = describeCatalogEntry(entry);
    expect(text).toContain("v1.2.0");
    expect(text).toContain("演示插件");
    expect(text).toContain("2 个组件");
  });

  it("没有版本与说明时只说组件数", () => {
    expect(describeCatalogEntry({ name: "x", source: "s", components: [] })).toBe("0 个组件");
  });
});

describe("安装报告摘要", () => {
  it("装好/跳过/失败都如实说", () => {
    const report: InstallResult = {
      installed: [{ kind: "skill", name: "a", to: "/x" }],
      skipped: [{ kind: "prompt", name: "b", to: "/y", reason: "exists" }],
      failed: [{ kind: "extension", name: "c", reason: "下载失败" }],
    };
    const text = summarizeInstallReport(report);
    expect(text).toContain("装好 1 项");
    expect(text).toContain("跳过 1 项");
    expect(text).toContain("失败 1 项");
  });

  it("全成功时不提跳过与失败", () => {
    const text = summarizeInstallReport({
      installed: [{ kind: "skill", name: "a", to: "/x" }],
      skipped: [],
      failed: [],
    });
    expect(text).not.toContain("失败");
  });
});
