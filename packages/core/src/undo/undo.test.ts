import { describe, expect, it } from "vitest";
import {
  createTurnJournal,
  journalSize,
  planUndo,
  recordPreImage,
  summarizeUndo,
} from "./journal.ts";

describe("文件回滚日志", () => {
  it("同一文件多次改动只保留最早的前像（撤销回到轮的起点）", () => {
    const journal = createTurnJournal();
    recordPreImage(journal, { path: "/a.txt", existed: true, content: "原始" });
    recordPreImage(journal, { path: "/a.txt", existed: true, content: "中间" });
    expect(journalSize(journal)).toBe(1);
    expect(planUndo(journal)).toEqual([{ kind: "restore", path: "/a.txt", content: "原始" }]);
  });

  it("本轮新建的文件在撤销时被删除", () => {
    const journal = createTurnJournal();
    recordPreImage(journal, { path: "/new.txt", existed: false, content: null });
    expect(planUndo(journal)).toEqual([{ kind: "delete", path: "/new.txt" }]);
  });

  it("计划按路径排序，执行顺序稳定", () => {
    const journal = createTurnJournal();
    recordPreImage(journal, { path: "/z.txt", existed: false, content: null });
    recordPreImage(journal, { path: "/a.txt", existed: true, content: "x" });
    expect(planUndo(journal).map((plan) => plan.path)).toEqual(["/a.txt", "/z.txt"]);
  });

  it("空日志给出「无需撤销」的说明", () => {
    const outcome = { reverted: [], failed: [] };
    expect(summarizeUndo(outcome)).toContain("没有文件改动需要撤销");
  });

  it("成功与失败都被如实报告（不假装撤干净）", () => {
    expect(summarizeUndo({ reverted: ["/a", "/b"], failed: [] })).toContain("2 个文件");
    const partial = summarizeUndo({
      reverted: ["/a"],
      failed: [{ path: "/b", error: "EACCES" }],
    });
    expect(partial).toContain("/b");
    expect(partial).toContain("EACCES");
  });
});
