import type { WorkspaceTreeEntry } from "@ucode/sdk";
import { describe, expect, it } from "vitest";
import {
  buildTreeRows,
  changeStatusLabel,
  depthOf,
  fileIcon,
  filterTreeRows,
  formatBytes,
  isImagePath,
  sortChanges,
} from "../workspace-format.ts";

const entry = (path: string, kind: "file" | "dir" = "file", size?: number): WorkspaceTreeEntry => ({
  path,
  name: path.split("/").pop() ?? path,
  kind,
  ...(size === undefined ? {} : { size }),
});

describe("depthOf", () => {
  it("缩进深度按路径段数", () => {
    expect(depthOf("a.ts")).toBe(0);
    expect(depthOf("src/a.ts")).toBe(1);
    expect(depthOf("src/core/a.ts")).toBe(2);
  });
});

describe("buildTreeRows", () => {
  it("按路径排序并保留名字与深度", () => {
    const rows = buildTreeRows([entry("src/b.ts"), entry("a.ts"), entry("src/a.ts")]);
    expect(rows.map((row) => row.entry.path)).toEqual(["a.ts", "src/a.ts", "src/b.ts"]);
    expect(rows.map((row) => row.depth)).toEqual([0, 1, 1]);
    expect(rows[1]?.label).toBe("a.ts");
  });
});

describe("filterTreeRows", () => {
  it("筛选匹配路径或文件名（大小写不敏感）", () => {
    const rows = buildTreeRows([entry("README.md"), entry("src/main.ts")]);
    expect(filterTreeRows(rows, "MAIN").map((row) => row.entry.path)).toEqual(["src/main.ts"]);
    expect(filterTreeRows(rows, "src/").length).toBe(1);
    expect(filterTreeRows(rows, "  ").length).toBe(2); // 空关键词不过滤
  });
});

describe("fileIcon", () => {
  it("目录、图片、普通文件各有图标", () => {
    expect(fileIcon(entry("src", "dir"))).toBe("▸");
    expect(fileIcon(entry("logo.png"))).toBe("▣");
    expect(fileIcon(entry("main.ts"))).toBe("·");
  });
});

describe("isImagePath", () => {
  it("图片扩展名识别（含大小写）", () => {
    expect(isImagePath("a/b/photo.JPG")).toBe(true);
    expect(isImagePath("icon.svg")).toBe(true);
    expect(isImagePath("main.ts")).toBe(false);
    expect(isImagePath("noext")).toBe(false);
  });
});

describe("formatBytes", () => {
  it("B / KB / MB 三档", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(3 * 1024 * 1024)).toBe("3.0 MB");
    expect(formatBytes(undefined)).toBe("");
  });
});

describe("changeStatusLabel", () => {
  it("git 状态码映射到可读标签", () => {
    expect(changeStatusLabel("??").label).toBe("未跟踪");
    expect(changeStatusLabel("M").label).toBe("修改");
    expect(changeStatusLabel("A ").label).toBe("新增");
    expect(changeStatusLabel("D").tone).toBe("danger");
    expect(changeStatusLabel("R").label).toBe("改名");
  });
});

describe("sortChanges", () => {
  it("排序把未跟踪放最后（先看真正改过的）", () => {
    const sorted = sortChanges([
      { path: "z.txt", status: "??" },
      { path: "b.txt", status: "M" },
      { path: "a.txt", status: "??" },
      { path: "c.txt", status: "D" },
    ]);
    expect(sorted.map((change) => change.path)).toEqual(["b.txt", "c.txt", "a.txt", "z.txt"]);
  });
});
