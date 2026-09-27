import { describe, expect, it } from "vitest";
import { composeFollowUpPrompt, DEFAULT_FOLLOW_UP, quoteExcerpt } from "./follow-up.ts";

describe("划选追问", () => {
  it("多行选中各自加引用前缀", () => {
    expect(quoteExcerpt("第一行\n第二行")).toBe("> 第一行\n> 第二行");
  });

  it("超长选中被截断并标注省略号", () => {
    const long = "字".repeat(1000);
    const quoted = quoteExcerpt(long, 100);
    expect(quoted.startsWith("> ")).toBe(true);
    expect(quoted.endsWith("…")).toBe(true);
    expect(quoted.length).toBeLessThanOrEqual(104);
  });

  it("空白选中不产生引用块", () => {
    expect(quoteExcerpt("   \n  ")).toBe("");
  });

  it("没写问题时给默认问法", () => {
    expect(composeFollowUpPrompt("一段内容", "   ")).toContain(DEFAULT_FOLLOW_UP);
  });

  it("有引用也有问题时，引用在前、问题在后", () => {
    const prompt = composeFollowUpPrompt("关键实现", "为什么要这样写？");
    expect(prompt).toContain("> 关键实现");
    expect(prompt).toContain("为什么要这样写？");
    expect(prompt.indexOf("> 关键实现")).toBeLessThan(prompt.indexOf("为什么要这样写？"));
  });

  it("没有选中内容时只发问题", () => {
    expect(composeFollowUpPrompt("", "只问问题")).toBe("只问问题");
  });
});
