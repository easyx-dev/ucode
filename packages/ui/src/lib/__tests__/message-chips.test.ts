/** 用户消息文本协议单测：前置展开块的剥离与引用标记的相对化 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ComposerPayload } from "../composer-payload";
import {
  contextMarker,
  parseUserMessage,
  relativizeContextRefs,
  userMessageText,
} from "../message-chips";

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
    assert.equal(parsed.skill, undefined);
  });

  it("技能名里的转义字符能还原（服务端会转义属性值）", () => {
    const raw = '<skill name="a&amp;b" location="/skills/a&amp;b.md">\n正文\n</skill>\n\n看看这个';

    const parsed = parseUserMessage(raw);

    assert.deepEqual(parsed.skill, { name: "a&b" });
    assert.equal(parsed.text, "看看这个");
  });

  it("技能自成 chip，附件引用行留在句子里", () => {
    const raw =
      '<skill name="review" location="/skills/review.md">\n技能正文\n</skill>\n\n' +
      '<context path="a.ts">\n内容\n</context>\n\n' +
      `[附件: 报告.pdf (id: ${"a".repeat(64)})]\n\n` +
      "看看 @a.ts";

    const parsed = parseUserMessage(raw);

    assert.deepEqual(parsed.skill, { name: "review" });
    // 引用行在头部（早期写法）时连同其后换行一起剥，气泡里不会多出空行
    assert.deepEqual(parsed.segments, [
      { type: "attachment", name: "报告.pdf", id: "a".repeat(64) },
      { type: "text", text: "看看 " },
      { type: "context", path: "a.ts" },
    ]);
    // 复制出去的是用户写的那句，不带引用行里的 id
    assert.equal(userMessageText(parsed), "/skill:review 看看 @a.ts");
  });

  it("没有前置块的消息原样返回", () => {
    assert.equal(parseUserMessage("随便说点什么").text, "随便说点什么");
  });

  it("命令只剩 chip，用户写的参数作为正文", () => {
    const raw = '<command name="review" args="改动 a.ts">\n你是一名代码审查员。\n</command>\n\n';

    const parsed = parseUserMessage(raw);

    assert.deepEqual(parsed.command, { name: "review", args: "改动 a.ts" });
    assert.equal(parsed.text, "");
    assert.equal(userMessageText(parsed), "/review 改动 a.ts");
  });

  it("命令参数在属性里转义后能还原", () => {
    const parsed = parseUserMessage(
      '<command name="ask" args="说 &quot;hi&quot; &amp; 结束">\n正文\n</command>\n\n',
    );
    assert.equal(parsed.command?.args, '说 "hi" & 结束');
  });

  it("无参数的命令还原时不留尾部空格", () => {
    const parsed = parseUserMessage('<command name="review" args="">\n正文\n</command>\n\n');
    assert.equal(userMessageText(parsed), "/review");
  });

  it("技能还原成 `/skill:name 参数`，正文就是块后的参数", () => {
    const parsed = parseUserMessage(
      '<skill name="tiny" location="/x/SKILL.md">\nReferences are relative to /x.\n\n技能正文\n</skill>\n\n看看这个',
    );

    assert.deepEqual(parsed.skill, { name: "tiny" });
    assert.equal(parsed.text, "看看这个");
    assert.equal(userMessageText(parsed), "/skill:tiny 看看这个");
  });

  it("无参数的技能还原时不带尾部空格", () => {
    const parsed = parseUserMessage(
      '<skill name="tiny" location="/x/SKILL.md">\nReferences are relative to /x.\n\n技能正文\n</skill>',
    );
    assert.equal(userMessageText(parsed), "/skill:tiny");
  });
});

describe("parseUserMessage 的正文分段", () => {
  it("引用标记切成 chip，句子其余部分留在文本段里", () => {
    const raw =
      '<context path="a.ts">\n内容\n</context>\n\n' +
      '<context path="b.ts">\n内容\n</context>\n\n' +
      "看看 @a.ts 与 @b.ts";

    const parsed = parseUserMessage(raw);

    assert.deepEqual(parsed.segments, [
      { type: "text", text: "看看 " },
      { type: "context", path: "a.ts" },
      { type: "text", text: " 与 " },
      { type: "context", path: "b.ts" },
    ]);
    assert.equal(parsed.text, "看看 @a.ts 与 @b.ts");
  });

  it("用户自己打的 `@` 与没引用过的路径都不是 chip", () => {
    const raw = '<context path="a.ts">\n内容\n</context>\n\n发给 @张三，看 @a.ts 与 @c.ts';

    const parsed = parseUserMessage(raw);

    assert.deepEqual(parsed.segments, [
      { type: "text", text: "发给 @张三，看 " },
      { type: "context", path: "a.ts" },
      { type: "text", text: " 与 @c.ts" },
    ]);
  });

  it("同一路径被引用两次时标记各切一次，多出来的留在文本里", () => {
    const raw = '<context path="a.ts">\n内容\n</context>\n\n看 @a.ts 再看 @a.ts';

    const parsed = parseUserMessage(raw);

    assert.deepEqual(parsed.segments, [
      { type: "text", text: "看 " },
      { type: "context", path: "a.ts" },
      { type: "text", text: " 再看 @a.ts" },
    ]);
  });

  it("前缀相同的两条引用按最长匹配切分", () => {
    const raw =
      '<context path="a.ts">\n内容\n</context>\n\n' +
      '<context path="a.ts.bak">\n内容\n</context>\n\n' +
      "看 @a.ts.bak 与 @a.ts";

    const parsed = parseUserMessage(raw);

    assert.deepEqual(parsed.segments, [
      { type: "text", text: "看 " },
      { type: "context", path: "a.ts.bak" },
      { type: "text", text: " 与 " },
      { type: "context", path: "a.ts" },
    ]);
  });

  it("没有引用时整段正文就是一个文本段", () => {
    assert.deepEqual(parseUserMessage("随便说点什么").segments, [
      { type: "text", text: "随便说点什么" },
    ]);
    assert.deepEqual(parseUserMessage("").segments, []);
  });

  it("引用段带着原展开块上的行范围", () => {
    const raw =
      '<context path="a.ts" lines="3-">\n内容\n</context>\n\n' +
      '<context path="b.ts" lines="5-9">\n内容\n</context>\n\n看 @a.ts 与 @b.ts';

    const parsed = parseUserMessage(raw);

    assert.deepEqual(
      parsed.segments.filter((segment) => segment.type === "context"),
      [
        { type: "context", path: "a.ts", startLine: 3 },
        { type: "context", path: "b.ts", startLine: 5, endLine: 9 },
      ],
    );
  });
});

describe("正文里的附件与图片标记", () => {
  it("附件引用行就地成段，前后文本照旧", () => {
    const raw = `看下 [附件: 报告.pdf (id: ${"b".repeat(64)})] 的结论`;

    assert.deepEqual(parseUserMessage(raw).segments, [
      { type: "text", text: "看下 " },
      { type: "attachment", name: "报告.pdf", id: "b".repeat(64) },
      { type: "text", text: " 的结论" },
    ]);
  });

  it("图片标记切出序号，位置即用户放的位置", () => {
    const parsed = parseUserMessage("看下 图片 1 的配色，再看 图片 2");

    assert.deepEqual(parsed.segments, [
      { type: "text", text: "看下 " },
      { type: "image", index: 1 },
      { type: "text", text: " 的配色，再看 " },
      { type: "image", index: 2 },
    ]);
  });

  it("`图片` 后面不是序号时留在文本里", () => {
    assert.deepEqual(parseUserMessage("图片集").segments, [{ type: "text", text: "图片集" }]);
  });

  it("引用行残留的 id 不进复制文本，图片标记也不进", () => {
    const parsed = parseUserMessage(`前 [附件: a.pdf (id: ${"c".repeat(64)})] 后 图片 1`);
    assert.equal(userMessageText(parsed), "前  后 ");
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
