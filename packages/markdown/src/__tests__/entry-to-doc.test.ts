/** 条目 → 编辑器文档 → 方言 的往返单测：附件与引用的位置与顺序都要保住 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { docToDialect } from "../document.ts";
import { parseEntryText } from "../entry.ts";
import { entryToDoc } from "../entry-to-doc.ts";

const ID_A = "a".repeat(64);
const ID_IMG = "b".repeat(64);

const docOf = (raw: string, images: string[] = []) => entryToDoc(parseEntryText(raw), images);

describe("entryToDoc", () => {
  it("引用、附件与图片都还原成节点，位置不动", () => {
    const raw =
      `<context path="plans/a.md" lines="1-20">\n内容\n</context>\n\n` +
      `看下 ${`[附件: 报告.pdf (id: ${ID_A})]`} 与 图片 1，参考 @plans/a.md`;

    const doc = docOf(raw, [ID_IMG]);
    const paragraph = doc.content?.[0];

    assert.deepEqual(
      paragraph?.content?.map((node) => node.type),
      ["text", "attachmentMention", "text", "attachmentMention", "text", "contextMention"],
    );
    assert.deepEqual(paragraph?.content?.[1]?.attrs, {
      id: ID_A,
      name: "报告.pdf",
      kind: "file",
      tempId: null,
    });
    assert.deepEqual(paragraph?.content?.[3]?.attrs, {
      id: ID_IMG,
      name: null,
      kind: "image",
      tempId: null,
    });
    assert.equal(paragraph?.content?.[5]?.attrs?.path, "plans/a.md");
    assert.equal(paragraph?.content?.[5]?.attrs?.startLine, 1);
    assert.equal(paragraph?.content?.[5]?.attrs?.endLine, 20);
  });

  it("换行拆成多个段落", () => {
    const doc = docOf("第一行\n第二行");
    assert.equal(doc.content?.length, 2);
  });

  it("命令的参数补回 mention 之后（条目里参数只在块属性上）", () => {
    // 服务端把整条输入换成 `<command …>` 块，参数不接在块后：改写 `/review 改动 a.ts`
    // 不能变成裸的 `/review`（重新展开时占位会被替换成空）
    const dialect = docToDialect(
      docOf('<command name="review" args="改动 a.ts">\n模板正文\n</command>\n\n'),
      {},
    );

    assert.equal(dialect, ":::command[review]\n改动 a.ts\n:::");
  });

  it("技能与命令还原成 mention 节点，参数跟在后面", () => {
    const skill = docOf(
      '<skill name="tiny" location="/x/SKILL.md" args="看看这个">\n技能正文\n</skill>\n\n',
    );
    assert.deepEqual(skill.content?.[0]?.content?.[0]?.attrs, {
      kind: "skill",
      name: "tiny",
      label: "/skill:tiny",
    });
    // 技能参数跟在节点之后（与命令同一套位置规则）
    assert.equal(skill.content?.[0]?.content?.[2]?.text, "看看这个");

    const command = docOf('<command name="review" args="改动 a.ts">\n模板正文\n</command>\n\n');
    assert.deepEqual(command.content?.[0]?.content?.[0]?.attrs, {
      kind: "prompt",
      name: "review",
      label: "/review",
    });
  });

  it("图片块对不上时丢掉那个节点，不发明一个空引用", () => {
    const doc = docOf("看 图片 2", [ID_IMG]);
    assert.deepEqual(
      doc.content?.[0]?.content?.map((node) => node.type),
      ["text"],
    );
  });
});

describe("条目正文往返", () => {
  it("改写后重发得到与首次发送同形的载荷", () => {
    const raw =
      `<context path="plans/a.md">\n内容\n</context>\n\n` +
      `看下 ${`[附件: 报告.pdf (id: ${ID_A})]`} 与 图片 1，参考 @plans/a.md`;

    const dialect = docToDialect(docOf(raw, [ID_IMG]), {});

    // 条目 → 文档 → 方言 走一圈回到同一句话：附件与引用都还在原位
    assert.equal(
      dialect,
      `看下 ![报告.pdf](attachment:pdf/${ID_A}) 与 ![](attachment:image/${ID_IMG})，参考 @plans/a.md`,
    );
  });

  it("技能消息往返后命令名与参数各归各位", () => {
    const dialect = docToDialect(
      docOf('<skill name="tiny" location="/x/SKILL.md" args="看看这个">\n技能正文\n</skill>\n\n'),
      {},
    );
    // 命令名写成容器围栏，参数在容器里：服务端按名字查技能，不再切 `/skill:name`
    assert.equal(dialect, ":::skill[tiny]\n看看这个\n:::");
  });

  it("命令消息往返后仍是「同一条命令 + 同一段参数」", () => {
    const dialect = docToDialect(
      docOf('<command name="review" args="改动 a.ts">\n模板正文\n</command>\n\n'),
      {},
    );
    assert.equal(dialect, ":::command[review]\n改动 a.ts\n:::");
  });

  // 命令参数挂在块属性上，但它是用户写的正文：里面的引用与图片要照样还原成节点
  it("命令参数里的引用与图片还原成节点，位置不动", () => {
    const raw =
      `<context path="plans/a.md">\n内容\n</context>\n\n` +
      `<command name="todo" args="看下 图片 1，参考 @plans/a.md">\n模板正文\n</command>\n\n`;

    const doc = docOf(raw, [ID_IMG]);
    const nodes = doc.content?.[0]?.content ?? [];

    assert.deepEqual(
      nodes.map((node) => node.type),
      ["commandMention", "text", "text", "attachmentMention", "text", "contextMention"],
    );
    assert.deepEqual(nodes[3]?.attrs, { id: ID_IMG, name: null, kind: "image", tempId: null });
    assert.equal(nodes[5]?.attrs?.path, "plans/a.md");
  });
});
