/** workbench-docs：编辑器标签的打开 / 切换 / 关闭与上限 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { GitCommitSummary } from "@ucode/contracts";

import {
  browserDoc,
  browserDocId,
  changeDoc,
  changesDoc,
  changesDocId,
  commitDoc,
  designDoc,
  designDocId,
  diffDocId,
  emptyWorkbenchDocs,
  fileDoc,
  fileDocId,
  MAX_WORKBENCH_DOCS,
  terminalDoc,
  terminalDocId,
  workbenchDocsReducer,
} from "../workbench-docs";

const commit = (hash: string): GitCommitSummary => ({
  hash,
  shortHash: hash.slice(0, 7),
  subject: "改点什么",
  authorName: "本地用户",
  authoredAt: "2026-01-01T00:00:00+08:00",
  refs: [],
});

describe("workbenchDocsReducer", () => {
  it("打开即追加并激活", () => {
    const state = workbenchDocsReducer(emptyWorkbenchDocs, { type: "open", doc: fileDoc("/a.ts") });
    assert.deepEqual(
      state.docs.map((doc) => doc.id),
      ["file:/a.ts"],
    );
    assert.equal(state.activeDocId, "file:/a.ts");
  });

  it("同一份内容重复打开只激活，不追加", () => {
    const first = workbenchDocsReducer(emptyWorkbenchDocs, {
      type: "open",
      doc: fileDoc("/a.ts"),
    });
    const second = workbenchDocsReducer(first, { type: "open", doc: fileDoc("/b.ts") });
    const third = workbenchDocsReducer(second, { type: "open", doc: fileDoc("/a.ts") });
    assert.equal(third.docs.length, 2);
    assert.equal(third.activeDocId, fileDocId("/a.ts"));
  });

  it("同一文件的预览与 diff 各占一个标签", () => {
    const state = workbenchDocsReducer(
      workbenchDocsReducer(emptyWorkbenchDocs, { type: "open", doc: fileDoc("/a.ts") }),
      { type: "open", doc: changeDoc("/repo", "/a.ts", false) },
    );
    assert.equal(state.docs.length, 2);
    assert.equal(state.docs[1]?.id, diffDocId("/a.ts", "worktree"));
  });

  it("超过上限时丢最早的那个，新的仍在最右且被激活", () => {
    let state = emptyWorkbenchDocs;
    for (let index = 0; index <= MAX_WORKBENCH_DOCS; index += 1) {
      state = workbenchDocsReducer(state, { type: "open", doc: fileDoc(`/f${index}.ts`) });
    }
    assert.equal(state.docs.length, MAX_WORKBENCH_DOCS);
    assert.equal(state.docs[0]?.id, fileDocId("/f1.ts"));
    assert.equal(state.activeDocId, fileDocId(`/f${MAX_WORKBENCH_DOCS}.ts`));
  });

  it("关掉激活项后接它右边那个", () => {
    let state = emptyWorkbenchDocs;
    for (const path of ["/a.ts", "/b.ts", "/c.ts"]) {
      state = workbenchDocsReducer(state, { type: "open", doc: fileDoc(path) });
    }
    state = workbenchDocsReducer(state, { type: "select", id: fileDocId("/b.ts") });
    state = workbenchDocsReducer(state, { type: "close", id: fileDocId("/b.ts") });
    assert.equal(state.activeDocId, fileDocId("/c.ts"));
  });

  it("关掉最右侧的激活项时退到左边", () => {
    let state = emptyWorkbenchDocs;
    for (const path of ["/a.ts", "/b.ts"]) {
      state = workbenchDocsReducer(state, { type: "open", doc: fileDoc(path) });
    }
    state = workbenchDocsReducer(state, { type: "close", id: fileDocId("/b.ts") });
    assert.equal(state.activeDocId, fileDocId("/a.ts"));
  });

  it("关掉非激活项不影响激活项", () => {
    let state = emptyWorkbenchDocs;
    for (const path of ["/a.ts", "/b.ts"]) {
      state = workbenchDocsReducer(state, { type: "open", doc: fileDoc(path) });
    }
    state = workbenchDocsReducer(state, { type: "close", id: fileDocId("/a.ts") });
    assert.equal(state.activeDocId, fileDocId("/b.ts"));
  });

  it("关掉最后一个标签后回到空态", () => {
    const opened = workbenchDocsReducer(emptyWorkbenchDocs, {
      type: "open",
      doc: fileDoc("/a.ts"),
    });
    const closed = workbenchDocsReducer(opened, { type: "close", id: fileDocId("/a.ts") });
    assert.deepEqual(closed, emptyWorkbenchDocs);
  });

  it("「全部改动」按工作目录去重，与单文件标签并存", () => {
    let state = workbenchDocsReducer(emptyWorkbenchDocs, {
      type: "open",
      doc: changeDoc("/repo", "a.ts", false),
    });
    state = workbenchDocsReducer(state, { type: "open", doc: changesDoc("/repo") });
    state = workbenchDocsReducer(state, { type: "open", doc: changesDoc("/repo") });
    assert.equal(state.docs.length, 2, "同一目录只留一个「全部改动」");
    assert.equal(state.activeDocId, changesDocId("/repo"));
  });

  it("关闭其他：只留右键的那一个并激活它", () => {
    let state = emptyWorkbenchDocs;
    for (const path of ["/a.ts", "/b.ts", "/c.ts"]) {
      state = workbenchDocsReducer(state, { type: "open", doc: fileDoc(path) });
    }
    state = workbenchDocsReducer(state, { type: "closeOthers", id: fileDocId("/b.ts") });
    assert.deepEqual(
      state.docs.map((doc) => doc.id),
      [fileDocId("/b.ts")],
    );
    assert.equal(state.activeDocId, fileDocId("/b.ts"));
  });

  it("关闭其他：右键的那个已不在时不动", () => {
    const state = workbenchDocsReducer(emptyWorkbenchDocs, {
      type: "open",
      doc: fileDoc("/a.ts"),
    });
    assert.equal(
      workbenchDocsReducer(state, { type: "closeOthers", id: fileDocId("/gone.ts") }),
      state,
    );
  });

  it("关闭全部：回到空态", () => {
    let state = emptyWorkbenchDocs;
    for (const path of ["/a.ts", "/b.ts"]) {
      state = workbenchDocsReducer(state, { type: "open", doc: fileDoc(path) });
    }
    assert.deepEqual(workbenchDocsReducer(state, { type: "closeAll" }), emptyWorkbenchDocs);
  });

  it("reset 清空标签", () => {
    const opened = workbenchDocsReducer(emptyWorkbenchDocs, {
      type: "open",
      doc: commitDoc("/repo", commit("abc1234def")),
    });
    assert.deepEqual(workbenchDocsReducer(opened, { type: "reset" }), emptyWorkbenchDocs);
  });
});

describe("终端标签", () => {
  it("一个终端一个标签，重复打开只激活", () => {
    const first = workbenchDocsReducer(emptyWorkbenchDocs, {
      type: "open",
      doc: terminalDoc("t1"),
    });
    const second = workbenchDocsReducer(first, { type: "open", doc: fileDoc("/a.ts") });
    const third = workbenchDocsReducer(second, { type: "open", doc: terminalDoc("t1") });

    assert.deepEqual(
      third.docs.map((doc) => doc.id),
      [terminalDocId("t1"), fileDocId("/a.ts")],
    );
    assert.equal(third.activeDocId, terminalDocId("t1"));
  });

  it("超出上限时先丢非终端标签，终端留着", () => {
    let state = emptyWorkbenchDocs;
    state = workbenchDocsReducer(state, { type: "open", doc: terminalDoc("t1") });
    for (let index = 0; index <= MAX_WORKBENCH_DOCS; index += 1) {
      state = workbenchDocsReducer(state, { type: "open", doc: fileDoc(`/f${index}.ts`) });
    }
    assert.equal(state.docs.length, MAX_WORKBENCH_DOCS);
    assert.ok(state.docs.some((doc) => doc.id === terminalDocId("t1")));
    assert.ok(!state.docs.some((doc) => doc.id === fileDocId("/f0.ts")));
  });

  it("标签全是终端时也得丢最老的（进程仍在服务端，列表里能重新打开）", () => {
    let state = emptyWorkbenchDocs;
    for (let index = 0; index <= MAX_WORKBENCH_DOCS; index += 1) {
      state = workbenchDocsReducer(state, { type: "open", doc: terminalDoc(`t${index}`) });
    }
    assert.equal(state.docs.length, MAX_WORKBENCH_DOCS);
    assert.ok(!state.docs.some((doc) => doc.id === terminalDocId("t0")));
  });
});

describe("设计画布标签", () => {
  it("按会话一格：同一会话重复打开只激活，换会话另开一格", () => {
    const first = workbenchDocsReducer(emptyWorkbenchDocs, {
      type: "open",
      doc: designDoc("s-1"),
    });
    const second = workbenchDocsReducer(first, { type: "open", doc: designDoc("s-2") });
    const third = workbenchDocsReducer(second, { type: "open", doc: designDoc("s-1") });

    assert.deepEqual(
      third.docs.map((doc) => doc.id),
      [designDocId("s-1"), designDocId("s-2")],
    );
    assert.equal(third.activeDocId, designDocId("s-1"));
  });

  it("reset 清掉设计标签（它属于会话，不跨会话留存）", () => {
    const opened = workbenchDocsReducer(emptyWorkbenchDocs, {
      type: "open",
      doc: designDoc("s-1"),
    });
    assert.deepEqual(workbenchDocsReducer(opened, { type: "reset" }), emptyWorkbenchDocs);
  });

  it("换会话只丢设计画布，文件标签留着", () => {
    let state = workbenchDocsReducer(emptyWorkbenchDocs, { type: "open", doc: fileDoc("/a.ts") });
    state = workbenchDocsReducer(state, { type: "open", doc: designDoc("s-1") });
    state = workbenchDocsReducer(state, { type: "dropDesign" });

    assert.deepEqual(
      state.docs.map((doc) => doc.id),
      [fileDocId("/a.ts")],
    );
    assert.equal(state.activeDocId, fileDocId("/a.ts"), "激活项被丢时回退到剩下的最后一个");
  });
});

describe("浏览器标签的留存", () => {
  it("换工作目录时留着（它跟工作目录无关），激活项落在留下的那个上", () => {
    let state = workbenchDocsReducer(emptyWorkbenchDocs, {
      type: "open",
      doc: fileDoc("/a.ts"),
    });
    state = workbenchDocsReducer(state, { type: "open", doc: browserDoc("t1") });
    state = workbenchDocsReducer(state, { type: "reset" });

    assert.deepEqual(
      state.docs.map((doc) => doc.id),
      [browserDocId("t1")],
    );
    assert.equal(state.activeDocId, browserDocId("t1"));
  });

  it("没有浏览器标签时 reset 清空（与原行为一致）", () => {
    let state = workbenchDocsReducer(emptyWorkbenchDocs, { type: "open", doc: fileDoc("/a.ts") });
    state = workbenchDocsReducer(state, { type: "reset" });
    assert.deepEqual(state, emptyWorkbenchDocs);
  });
});
