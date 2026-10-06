/** 用户消息文本协议单测：前置展开块的剥离与引用标记的相对化 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ComposerPayload } from "../composer-payload";
import { contextMarker, parseUserMessage, relativizeContextRefs } from "../message-chips";

const payloadOf = (text: string, contexts: string[]): ComposerPayload => ({
  text,
  contexts: contexts.map((path) => ({ path })),
  attachments: [],
});

describe("parseUserMessage", () => {
  it("剥掉前置的展开块，引用标记留在句子里", () => {
    const raw =
      '<context path="plans/a.md" lines="1-20">\n文件内容\n</context>\n\n' +
      "把这个计划落到 @plans/a.md 中，然后记个 todo";

    const parsed = parseUserMessage(raw);

    assert.equal(parsed.text, "把这个计划落到 @plans/a.md 中，然后记个 todo");
    assert.deepEqual(parsed.attachments, []);
    assert.equal(parsed.skill, undefined);
  });

  it("技能与附件仍各自成 chip，正文只留用户原文", () => {
    const raw =
      '<skill name="review" location="/skills/review.md">\n技能正文\n</skill>\n\n' +
      '<context path="a.ts">\n内容\n</context>\n\n' +
      `[附件: 报告.pdf (id: ${"a".repeat(64)})]\n\n` +
      "看看 @a.ts";

    const parsed = parseUserMessage(raw);

    assert.deepEqual(parsed.skill, { name: "review" });
    assert.deepEqual(parsed.attachments, [{ name: "报告.pdf", id: "a".repeat(64) }]);
    assert.equal(parsed.text, "看看 @a.ts");
  });

  it("没有前置块的消息原样返回", () => {
    assert.equal(parseUserMessage("随便说点什么").text, "随便说点什么");
  });
});

describe("relativizeContextRefs", () => {
  it("标记换成相对工作目录的写法，句子其余部分不动", () => {
    const payload = payloadOf(
      "修一下 @/repo/packages/ui/src/app.ts，再补 @/repo/docs/api.md 的说明",
      ["/repo/packages/ui/src/app.ts", "/repo/docs/api.md"],
    );

    const sent = relativizeContextRefs(payload, "/repo");

    assert.equal(sent.text, "修一下 @packages/ui/src/app.ts，再补 @docs/api.md 的说明");
    assert.deepEqual(sent.contexts, payload.contexts);
  });

  it("同一个文件被引用多次时全部替换", () => {
    const sent = relativizeContextRefs(
      payloadOf("@/repo/a.ts 和 @/repo/a.ts", ["/repo/a.ts"]),
      "/repo",
    );
    assert.equal(sent.text, "@a.ts 和 @a.ts");
  });

  it("认不出工作目录时保持原样（返回同一个载荷）", () => {
    const payload = payloadOf("看 @/repo/a.ts", ["/repo/a.ts"]);
    assert.equal(relativizeContextRefs(payload, undefined), payload);
  });

  it("引用不在工作目录下时保持绝对路径", () => {
    const sent = relativizeContextRefs(payloadOf("看 @/other/a.ts", ["/other/a.ts"]), "/repo");
    assert.equal(sent.text, "看 @/other/a.ts");
  });

  it("前缀相同的兄弟目录不被当成工作目录内", () => {
    const sent = relativizeContextRefs(payloadOf("看 @/repo2/a.ts", ["/repo2/a.ts"]), "/repo");
    assert.equal(sent.text, "看 @/repo2/a.ts");
  });

  it("用户自己打的 `@` 不受影响", () => {
    const payload = payloadOf("邮件发给 @张三，另看 @/repo/a.ts", ["/repo/a.ts"]);
    const sent = relativizeContextRefs(payload, "/repo");
    assert.equal(sent.text, "邮件发给 @张三，另看 @a.ts");
  });

  it("工作目录带尾随斜杠时同样换算", () => {
    const sent = relativizeContextRefs(payloadOf("看 @/repo/a.ts", ["/repo/a.ts"]), "/repo/");
    assert.equal(sent.text, "看 @a.ts");
  });

  it("没有引用时不改载荷", () => {
    const payload = payloadOf("纯文本", []);
    assert.equal(relativizeContextRefs(payload, "/repo"), payload);
  });
});

describe("contextMarker", () => {
  it("标记是路径加 `@` 前缀，与剥离后的正文一致", () => {
    const raw = `<context path="a.ts">\n内容\n</context>\n\n看看 ${contextMarker("/repo/a.ts")}`;
    assert.equal(parseUserMessage(raw).text, "看看 @/repo/a.ts");
  });
});
