/** 消息文档往返单测：条目正文 → 编辑器文档 → 载荷，附件与引用的位置与顺序都要保住 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { docToPayload } from "../../../composer/document/composer-document";
import { parseUserMessage } from "../../../composer/document/message-chips";
import { messageTextToDoc } from "../message-document";

const ID_A = "a".repeat(64);
const ID_IMG = "b".repeat(64);

const docOf = (raw: string, images: string[] = []) =>
  messageTextToDoc(parseUserMessage(raw), images);

describe("messageTextToDoc", () => {
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
    const payload = docToPayload(
      docOf('<command name="review" args="改动 a.ts">\n模板正文\n</command>\n\n'),
    );

    assert.equal(payload.text, "/review 改动 a.ts");
  });

  it("技能与命令还原成 mention 节点，参数跟在后面", () => {
    const skill = docOf(
      '<skill name="tiny" location="/x/SKILL.md">\n技能正文\n</skill>\n\n看看这个',
    );
    assert.deepEqual(skill.content?.[0]?.content?.[0]?.attrs, {
      kind: "skill",
      name: "tiny",
      label: "/skill:tiny",
    });

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

    const payload = docToPayload(docOf(raw, [ID_IMG]));

    assert.equal(payload.text, "看下 附件 1.pdf 与 图片 1，参考 @plans/a.md");
    assert.deepEqual(payload.contexts, [{ path: "plans/a.md" }]);
    assert.deepEqual(payload.attachments, [{ id: ID_A }, { id: ID_IMG }]);
  });

  it("技能消息往返后仍是 `/skill:name 参数`", () => {
    const payload = docToPayload(
      docOf('<skill name="tiny" location="/x/SKILL.md">\n技能正文\n</skill>\n\n看看这个'),
    );
    assert.equal(payload.text, "/skill:tiny 看看这个");
  });
});
