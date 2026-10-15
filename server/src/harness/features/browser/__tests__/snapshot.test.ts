/**
 * 快照与编号的单测：不依赖真浏览器，只测纯逻辑与页面侧脚本的静态形状。
 * 编号稳定性是这一块的核心——它是「多步操作不乱」的前提（见 plans/browser-tools.md 3.2）。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assignRefs,
  candidateKey,
  diffSnapshots,
  fingerprintOf,
  formatEntry,
  formatSnapshot,
  indexCandidates,
  pruneCandidates,
  refOfKey,
  type SnapshotCandidate,
} from "../snapshot";

const button = (name: string, extra: Partial<SnapshotCandidate> = {}): SnapshotCandidate => ({
  role: "button",
  name,
  tag: "button",
  ...extra,
});

describe("编号", () => {
  it("同键同号：同一个 role + 名字在两次快照里拿到同样的 ref", () => {
    const first = assignRefs([button("登录"), button("注册")]);
    const second = assignRefs([button("登录"), button("注册")]);
    assert.deepEqual(
      first.map((entry) => entry.ref),
      second.map((entry) => entry.ref),
    );
  });

  it("页面多出一个元素时，已有元素的 ref 不变（只有新元素拿新号）", () => {
    const before = assignRefs([button("登录"), button("注册")]);
    const after = assignRefs([
      { role: "generic", name: "toast", tag: "div" },
      button("登录"),
      button("注册"),
    ]);
    const lookup = new Map(after.map((entry) => [entry.name, entry.ref]));
    for (const entry of before) assert.equal(lookup.get(entry.name), entry.ref);
  });

  it("同名的多个元素各自拿到唯一 ref", () => {
    const entries = assignRefs([button("确定"), button("确定"), button("确定")]);
    assert.equal(new Set(entries.map((entry) => entry.ref)).size, 3);
  });

  it("哈希撞号时向后探测，仍保证一份快照内唯一", () => {
    // 直接构造两个同键的候选是走不到撞号的，这里验证的是「唯一性由 taken 集合兜底」
    const refs = assignRefs([button("a"), button("b"), button("a")]).map((entry) => entry.ref);
    assert.equal(new Set(refs).size, refs.length);
  });

  it("键含同名序号，因此同键不同次的 ref 不同", () => {
    assert.notEqual(
      refOfKey(candidateKey(button("确定"), 0)),
      refOfKey(candidateKey(button("确定"), 1)),
    );
  });
});

describe("渲染", () => {
  it("一行一个元素，带编号、role、名字与状态", () => {
    const entries = assignRefs([button("提交", { state: "禁用" })]);
    const entry = entries[0];
    assert.ok(entry, "应当有编号结果");
    assert.match(formatEntry(entry), /^@e[0-9a-z]{4} button "提交" \[禁用\]$/);
  });

  it("超过条数上限即截断，并说明总数", () => {
    const entries = assignRefs([button("a"), button("b"), button("c")]);
    const formatted = formatSnapshot(entries, { maxElements: 2 });
    assert.equal(formatted.truncated, true);
    assert.match(formatted.text, /共 3 个元素，这里只列出前 2 个/);
  });

  it("超过字符上限即截断", () => {
    const formatted = formatSnapshot(assignRefs([button("x".repeat(200))]), { maxChars: 40 });
    assert.equal(formatted.truncated, true);
  });
});

describe("指纹与差量", () => {
  it("同一个页面指纹相同，元素变化后指纹不同", () => {
    const before = assignRefs([button("a")]);
    assert.equal(fingerprintOf(before), fingerprintOf(assignRefs([button("a")])));
    assert.notEqual(fingerprintOf(before), fingerprintOf(assignRefs([button("a"), button("b")])));
  });

  it("差量只列新增 / 消失 / 变化，并说明「只回传变化部分」由调用方负责", () => {
    const before = assignRefs([button("a"), button("b")]);
    const after = assignRefs([button("a"), button("c", { state: "禁用" })]);
    const diff = diffSnapshots(before, after);
    assert.equal(diff.added.length, 1);
    assert.equal(diff.removed.length, 1);
    assert.match(diff.text, /新增：/);
    assert.match(diff.text, /消失：/);
  });

  it("没有变化时给一句明确的说明", () => {
    const entries = assignRefs([button("a")]);
    assert.equal(diffSnapshots(entries, assignRefs([button("a")])).text, "页面结构与上次快照一致");
  });
});

describe("取噪", () => {
  it("丢掉没有名字的通用容器与视口外的元素，其余原样保留", () => {
    const kept = pruneCandidates([
      button("登录"),
      { role: "generic", name: "", tag: "div" },
      { role: "generic", name: "卡片", tag: "div" },
      { role: "button", name: "底部的按钮", tag: "button", offscreen: true },
    ]);
    assert.deepEqual(
      kept.map((entry) => entry.name),
      ["登录", "卡片"],
    );
  });

  it("取噪不改变留下元素的编号（编号按 role + 名字算）", () => {
    const candidates = [button("登录"), { role: "generic", name: "", tag: "div" }, button("注册")];
    const all = assignRefs(candidates);
    const pruned = assignRefs(pruneCandidates(candidates));
    const lookup = new Map(pruned.map((entry) => [entry.name, entry.ref]));
    for (const entry of all.filter((item) => item.name !== "")) {
      assert.equal(lookup.get(entry.name), entry.ref, entry.name);
    }
  });
});

describe("取噪保留序号", () => {
  it("compact 打开时丢掉噪声，但留下的元素带着原始序号", () => {
    const indexed = indexCandidates(
      [
        button("登录"),
        { role: "generic", name: "", tag: "div" },
        button("注册"),
        { role: "button", name: "底部", tag: "button", offscreen: true },
      ],
      { compact: true },
    );
    assert.deepEqual(
      indexed.map((item) => [item.index, item.candidate.name]),
      [
        [0, "登录"],
        [2, "注册"],
      ],
    );
  });

  it("compact 关闭时序号就是下标本身", () => {
    const candidates: SnapshotCandidate[] = [
      button("登录"),
      { role: "generic", name: "", tag: "div" },
    ];
    assert.deepEqual(
      indexCandidates(candidates).map((item) => item.index),
      [0, 1],
    );
  });
});
