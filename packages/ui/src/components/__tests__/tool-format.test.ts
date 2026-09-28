import type { DisplayItem } from "@ucode/sdk";
import { describe, expect, it } from "vitest";
import { toolContentPreview, toolLabel, toolOutputPreview, toolSummary } from "../tool-format.ts";

type ToolItem = Extract<DisplayItem, { kind: "tool" }>;

function tool(over: Partial<ToolItem> = {}): ToolItem {
  return {
    kind: "tool",
    id: "t1",
    seq: 1,
    callId: "c1",
    toolName: "bash",
    args: {},
    status: "done",
    output: "",
    timestamp: "",
    ...over,
  };
}

describe("toolLabel", () => {
  it("已知工具给中文名", () => {
    expect(toolLabel("read")).toBe("读取");
    expect(toolLabel("bash")).toBe("命令");
    expect(toolLabel("edit_file")).toBe("编辑");
  });

  it("MCP 工具拆成 服务器 · 工具", () => {
    expect(toolLabel("mcp__filesystem__read_file")).toBe("filesystem · read_file");
  });

  it("不认识的工具原样显示（不能变成一片「工具」）", () => {
    expect(toolLabel("my_custom_tool")).toBe("my_custom_tool");
  });
});

describe("toolSummary", () => {
  it("命令类给命令本身", () => {
    expect(toolSummary(tool({ args: { command: "ls -la" } }))).toBe("ls -la");
  });

  it("文件类给路径", () => {
    expect(toolSummary(tool({ toolName: "read", args: { path: "/tmp/a.ts" } }))).toBe("/tmp/a.ts");
    expect(toolSummary(tool({ toolName: "write_file", args: { file_path: "b.ts" } }))).toBe("b.ts");
  });

  it("搜索类把模式与范围拼起来（否则不知道搜的是哪里）", () => {
    expect(toolSummary(tool({ toolName: "grep", args: { pattern: "TODO", path: "src" } }))).toBe(
      "TODO · src",
    );
  });

  it("子智能体/提问类给描述文本", () => {
    expect(toolSummary(tool({ toolName: "task", args: { description: "查一下依赖" } }))).toBe(
      "查一下依赖",
    );
  });

  it("过长描述截断", () => {
    const text = toolSummary(tool({ toolName: "task", args: { description: "字".repeat(200) } }));
    expect(text.endsWith("…")).toBe(true);
    expect(text.length).toBeLessThanOrEqual(121);
  });

  it("没有可识别参数时退化成参数名列表，而不是空串", () => {
    expect(toolSummary(tool({ toolName: "weird_tool", args: { foo: 1, bar: 2 } }))).toBe(
      "foo · bar",
    );
  });

  it("命令类没有 command 参数时给一句兜底", () => {
    expect(toolSummary(tool({ args: {} }))).toBe("执行命令");
  });

  it("完全没有参数的未知工具返回空串（界面上不会出现多余的分隔符）", () => {
    expect(toolSummary(tool({ toolName: "weird_tool", args: {} }))).toBe("");
  });
});

describe("toolOutputPreview", () => {
  it("短输出原样返回", () => {
    expect(toolOutputPreview("一行\n两行")).toEqual({ lines: ["一行", "两行"], hidden: 0 });
  });

  it("长输出只留尾部，并报出被省掉的行数", () => {
    const output = Array.from({ length: 30 }, (_, index) => `第 ${index} 行`).join("\n");
    const preview = toolOutputPreview(output, 10);
    expect(preview.hidden).toBe(20);
    expect(preview.lines).toHaveLength(10);
    expect(preview.lines.at(-1)).toBe("第 29 行");
  });

  it("空输出不产生空行", () => {
    expect(toolOutputPreview("   \n  ")).toEqual({ lines: [], hidden: 0 });
  });
});

describe("toolContentPreview", () => {
  it("没有内容字段时返回 null（不是空串，调用方据此决定不渲染）", () => {
    expect(toolContentPreview({ path: "/a" })).toBeNull();
  });

  it("内容过长时只给开头并说明总行数", () => {
    const content = Array.from({ length: 20 }, (_, index) => `L${index}`).join("\n");
    const preview = toolContentPreview({ content }, 5);
    expect(preview).toContain("L0");
    expect(preview).toContain("共 20 行");
    expect(preview?.split("\n")).toHaveLength(6);
  });
});
