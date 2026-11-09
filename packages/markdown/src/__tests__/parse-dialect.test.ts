/** 方言解析单测：容器、行内记号、转义、非解析区与诊断 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseDialect } from "../parse.ts";
import { hasDialectSyntax } from "../scan.ts";
import type { InvocationCandidates } from "../types.ts";

const IMG = "b".repeat(64);
const PDF = "c".repeat(64);
const candidates: InvocationCandidates = {
  prompts: [{ name: "todo" }, { name: "review" }],
  skills: [{ name: "pdf" }],
};

describe("parseDialect 的容器", () => {
  it("命令进 command，参数是容器内容；容器外的文本是正文", () => {
    const doc = parseDialect(
      `:::command[todo]\n看下 @src/auth.ts#L10-L40\n:::\n\n正文收尾`,
      candidates,
    );

    assert.deepEqual(doc.command, { name: "todo", args: "看下 @src/auth.ts" });
    assert.equal(doc.text, "正文收尾");
    assert.deepEqual(doc.contexts, [{ path: "src/auth.ts", startLine: 10, endLine: 40 }]);
    assert.deepEqual(doc.diagnostics, []);
  });

  it("技能可多条，顺序即注入顺序，各自带参数", () => {
    const doc = parseDialect(
      `:::skill[pdf]\n生成报告\n:::\n\n:::skill[pdf]\n换个参数\n:::`,
      candidates,
    );

    assert.deepEqual(doc.skills, [
      { name: "pdf", args: "生成报告" },
      { name: "pdf", args: "换个参数" },
    ]);
  });

  it("只有第一个命令成立，其余报 command-duplicated", () => {
    const doc = parseDialect(
      `:::command[todo]\n一\n:::\n\n:::command[review]\n二\n:::`,
      candidates,
    );

    assert.deepEqual(doc.command, { name: "todo", args: "一" });
    assert.deepEqual(
      doc.diagnostics.map((item) => item.code),
      ["command-duplicated"],
    );
  });

  it("名字不在清单时报诊断，但结构不丢（界面据此拦住发送）", () => {
    const doc = parseDialect(`:::command[nope]\n参数\n:::`, candidates);

    assert.deepEqual(doc.command, { name: "nope", args: "参数" });
    assert.equal(doc.diagnostics[0]?.code, "command-unknown");
  });

  it("未闭合：内容取到文末，并报 container-unclosed", () => {
    const doc = parseDialect(`:::command[todo]\n参数在这里\n`, candidates);

    assert.deepEqual(doc.command, { name: "todo", args: "参数在这里" });
    assert.deepEqual(
      doc.diagnostics.map((item) => item.code),
      ["container-unclosed"],
    );
  });

  // 同级并列：容器里的围栏会先把外层关掉，所以要显式报错而不是猜用户想嵌套
  it("容器内容里又出现围栏时报 container-nested", () => {
    const doc = parseDialect(`:::command[todo]\n参数\n:::skill[pdf]\n技能\n:::\n:::`, candidates);

    assert.equal(doc.diagnostics[0]?.code, "container-nested");
  });

  it("未知指令名原样留在正文里（外部工具的自定义容器不该被判错）", () => {
    const doc = parseDialect(`:::note[x]\n别的工具的容器\n:::`, candidates);

    assert.equal(doc.text, ":::note[x]\n别的工具的容器\n:::");
    assert.deepEqual(doc.diagnostics, []);
  });

  it("代码围栏里的围栏不生效", () => {
    const doc = parseDialect("```\n:::command[todo]\n不该生效\n:::\n```\n", candidates);

    assert.equal(doc.command, undefined);
    assert.equal(doc.text.startsWith("```"), true);
  });
});

describe("parseDialect 的行内记号", () => {
  it("行内代码与转义都是字面，裸路径才成引用", () => {
    const doc = parseDialect("行内 `@src/a.ts` 与 \\@src/b.ts，但 @src/c.ts 是引用", candidates);

    assert.equal(doc.text, "行内 `@src/a.ts` 与 @src/b.ts，但 @src/c.ts 是引用");
    assert.deepEqual(doc.contexts, [{ path: "src/c.ts" }]);
  });

  it("昵称与邮箱保持字面：裸路径必须像路径，`@` 前是 ASCII 词字符时也不算", () => {
    const doc = parseDialect("@用户名 你好，联系 foo@bar.com 或 @README.md", candidates);

    assert.equal(doc.text, "@用户名 你好，联系 foo@bar.com 或 @README.md");
    assert.deepEqual(doc.contexts, [{ path: "README.md" }]);
  });

  it("同一路径同一行范围只进一份 contexts，正文里的两处标记都留着", () => {
    const doc = parseDialect("先 @src/a.ts#L1-L2 后 @src/a.ts#L1-L2", candidates);

    assert.equal(doc.text, "先 @src/a.ts 后 @src/a.ts");
    assert.deepEqual(doc.contexts, [{ path: "src/a.ts", startLine: 1, endLine: 2 }]);
  });

  it("附件按文档顺序编号，图片与非图片各自从 1 起", () => {
    const doc = parseDialect(
      `看 ![](attachment:image/${IMG}) 与 ![报告.pdf](attachment:pdf/${PDF}) 再 ![](attachment:image/${IMG})`,
      candidates,
    );

    assert.equal(doc.text, "看 图片 1 与 附件 1.pdf 再 图片 2");
    assert.deepEqual(doc.attachments, [{ id: IMG }, { id: PDF }, { id: IMG }]);
  });

  // 正文里截断的 `![` 不能到下一个区域去凑一个附件出来
  it("截断的附件写法不会读到后面的容器里", () => {
    const doc = parseDialect(`![x](attachment:image/\n:::skill[pdf]\n生成报告\n:::`, candidates);

    // 越界就不认（本来也不是一条成形的记号），按字面留着、不出一条引用错误
    assert.deepEqual(doc.attachments, []);
    assert.deepEqual(doc.diagnostics, []);
    assert.equal(doc.text, "![x](attachment:image/");
    assert.deepEqual(doc.skills, [{ name: "pdf", args: "生成报告" }]);
  });

  it("scheme 里的 id 不合法时按字面留着并提示", () => {
    const doc = parseDialect("坏的 ![](attachment:image/not-a-hash) 引用", candidates);

    assert.equal(doc.text, "坏的 ![](attachment:image/not-a-hash) 引用");
    assert.equal(doc.diagnostics[0]?.code, "attachment-invalid");
  });
});

// 期望值与文档投影（`docToDialect` 走的同一条口径）逐字一致：方言只是同一份口径的另一种写法
describe("parseDialect 与文档投影同口径", () => {
  it("引用 + 附件：text / contexts / attachments 完全一致", () => {
    const doc = parseDialect(
      `看下 @src/auth.ts#L10-L40 与 ![报告.pdf](attachment:pdf/${PDF})`,
      candidates,
    );

    assert.equal(doc.text, "看下 @src/auth.ts 与 附件 1.pdf");
    assert.deepEqual(doc.contexts, [{ path: "src/auth.ts", startLine: 10, endLine: 40 }]);
    assert.deepEqual(doc.attachments, [{ id: PDF }]);
  });

  it("命令 + 图片：参数文本与文档投影的 text 一致", () => {
    const doc = parseDialect(
      `:::command[todo]\n根据 ![](attachment:image/${IMG}) 记录一条待办\n:::`,
      candidates,
    );

    assert.equal(doc.command?.args, "根据 图片 1 记录一条待办");
    assert.deepEqual(doc.attachments, [{ id: IMG }]);
    assert.equal(doc.text, "");
  });
});

describe("引用锚点", () => {
  it("scheme 在表里的 `@scheme:…` 不是文件引用：原样留在正文里", () => {
    const anchor = "@design:s-1/1:2/1:3";
    const doc = parseDialect(`把 ${anchor} 改成深色`, {
      prompts: [],
      skills: [],
      mentions: ["design"],
    });
    // 当成引用就会去磁盘上找这个「文件」，发送时必然报路径不存在
    assert.deepEqual(doc.contexts, []);
    assert.equal(doc.text, `把 ${anchor} 改成深色`);
  });

  it("scheme 不在表里时仍按文件引用处理（内核对 scheme 一无所知）", () => {
    const doc = parseDialect("@design:s-1/1:2", { prompts: [], skills: [] });
    assert.deepEqual(doc.contexts, [{ path: "design:s-1/1:2" }]);
  });
});

describe("hasDialectSyntax", () => {
  it("认出会真的生效的记号：容器围栏、能成形的引用与附件", () => {
    assert.equal(hasDialectSyntax(":::command[todo]\n记一条\n:::"), true);
    assert.equal(hasDialectSyntax("看下 @src/a.ts#L1-L2"), true);
    assert.equal(hasDialectSyntax(`看 ![](attachment:image/${IMG})`), true);
    // 写了 scheme 但 id 不合法：粘贴时同样要转义，否则会被当成语法处理
    assert.equal(hasDialectSyntax("坏的 ![](attachment:image/not-a-hash)"), true);
  });

  it("普通文字不算：昵称、邮箱、手打的名字都不触发", () => {
    assert.equal(hasDialectSyntax("联系 @用户名 或 foo@bar.com，另外 /todo 记一条"), false);
    assert.equal(hasDialectSyntax("注意：这里有三个冒号 ::: 但不是围栏"), false);
    assert.equal(hasDialectSyntax("行内 `@src/a.ts` 是字面"), false);
    assert.equal(hasDialectSyntax("```\n:::command[todo]\n```"), false);
  });
});
