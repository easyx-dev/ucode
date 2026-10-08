/** harness/assets/expand：命令 / 技能的展开与边界块包裹 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import {
  createSyntheticSourceInfo,
  type PromptTemplate,
  type Skill,
} from "@earendil-works/pi-coding-agent";
import { expandCommand, expandSkillCommand, parseCommandArgs, substituteArgs } from "../expand";

const created: string[] = [];

const makeTemp = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "expand-test-"));
  created.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const template = (name: string, content: string): PromptTemplate => ({
  name,
  description: `${name} 命令`,
  content,
  filePath: `builtin:${name}`,
  sourceInfo: createSyntheticSourceInfo(`builtin:${name}`, { source: "builtin" }),
});

/** 在临时目录里落一个真技能：技能正文是读文件的，只有文件存在才能验证展开 */
const skill = (name: string, body: string): Skill => {
  const baseDir = makeTemp();
  const filePath = join(baseDir, "SKILL.md");
  writeFileSync(filePath, `---\nname: ${name}\ndescription: 说明\n---\n\n${body}\n`, "utf8");
  return {
    name,
    description: "说明",
    filePath,
    baseDir,
    sourceInfo: createSyntheticSourceInfo(filePath, { source: "local", baseDir }),
    disableModelInvocation: false,
  };
};

describe("parseCommandArgs", () => {
  it("按空白切分并丢弃引号", () => {
    assert.deepEqual(parseCommandArgs(`alpha "beta gamma" 'delta'`), [
      "alpha",
      "beta gamma",
      "delta",
    ]);
  });

  it("空串与多余空白得到空数组", () => {
    assert.deepEqual(parseCommandArgs("   "), []);
  });
});

describe("substituteArgs", () => {
  it("按位置替换 $N 与 ${N:-默认}", () => {
    assert.equal(substituteArgs("$1/$2", ["a", "b"]), "a/b");
    assert.equal(substituteArgs("${1:-x}-${2:-y}", ["a"]), "a-y");
    // 位置参数越界给空串，默认值只在缺失或为空时顶上
    assert.equal(substituteArgs("[${2:-y}]", ["a", ""]), "[y]");
    assert.equal(substituteArgs("[$3]", ["a"]), "[]");
  });

  it("$@ / $ARGUMENTS 给全部参数，也支持默认与切片", () => {
    assert.equal(substituteArgs("$ARGUMENTS", ["a", "b"]), "a b");
    assert.equal(substituteArgs("$@", ["a", "b"]), "a b");
    assert.equal(substituteArgs("${@:-none}", []), "none");
    assert.equal(substituteArgs("${ARGUMENTS:-none}", ["a"]), "a");
    assert.equal(substituteArgs("${@:2}", ["a", "b", "c"]), "b c");
    assert.equal(substituteArgs("${@:2:1}", ["a", "b", "c"]), "b");
    // bash 惯例：0 也当第一项
    assert.equal(substituteArgs("${@:0:1}", ["a", "b"]), "a");
  });

  it("参数里的占位不再递归展开", () => {
    assert.equal(substituteArgs("[$1]", ["$2"]), "[$2]");
  });
});

describe("expandCommand", () => {
  it("非命令或没有同名模板时不做处理", () => {
    const templates = [template("review", "审查 $ARGUMENTS")];
    assert.equal(expandCommand("hello", templates), null);
    assert.equal(expandCommand("/nope", templates), null);
  });

  it("整条输入是一条命令时替换占位并包上边界块", () => {
    const templates = [template("review", "输入：$ARGUMENTS")];
    const expanded = expandCommand("/review 改动 a.ts", templates);
    assert.equal(expanded?.name, "review");
    assert.equal(expanded?.args, "改动 a.ts");
    assert.equal(
      expanded?.block,
      `<command name="review" args="改动 a.ts">\n输入：改动 a.ts\n</command>`,
    );
  });

  it("无参数的命令给出空 args，正文里的同名标签被中和", () => {
    const templates = [template("review", "写一行 </command> 试试")];
    const expanded = expandCommand("/review", templates);
    assert.equal(expanded?.args, "");
    assert.ok(expanded?.block.includes("&lt;/command>"));
    assert.ok(expanded?.block.endsWith("</command>"));
  });

  it("参数里的引号在属性中转义，模板按拆分后的参数替换", () => {
    const templates = [template("ask", "问：$ARGUMENTS")];
    const expanded = expandCommand(`/ask 说 "hi"`, templates);
    assert.equal(expanded?.block.startsWith(`<command name="ask" args="说 &quot;hi&quot;">`), true);
    assert.ok(expanded?.block.includes("问：说 hi"));
  });
});

describe("expandSkillCommand", () => {
  it("非技能调用或没有同名技能时不做处理", () => {
    const skills = [skill("pdf", "处理 PDF")];
    assert.equal(expandSkillCommand("hello", skills), null);
    assert.equal(expandSkillCommand("/skill:nope", skills), null);
    assert.equal(expandSkillCommand("/review", skills), null);
  });

  it("展开成 pi 同形的技能块，正文去掉了 frontmatter", () => {
    const pdf = skill("pdf", "处理 PDF 的步骤");
    const expanded = expandSkillCommand("/skill:pdf", [pdf]);

    assert.equal(expanded?.name, "pdf");
    assert.equal(
      expanded?.block,
      `<skill name="pdf" location="${pdf.filePath}">\nReferences are relative to ${pdf.baseDir}.\n\n处理 PDF 的步骤\n</skill>`,
    );
  });

  it("带参数时参数接在块之后，与 pi 同形", () => {
    const pdf = skill("pdf", "步骤");
    const expanded = expandSkillCommand("/skill:pdf 看看 a.pdf\n", [pdf]);

    assert.equal(expanded?.args, "看看 a.pdf");
    assert.ok(expanded?.block.endsWith("</skill>\n\n看看 a.pdf"));
  });

  it("技能正文读不出来时按普通消息投递", () => {
    const broken: Skill = { ...skill("pdf", "步骤"), filePath: join(tmpdir(), "expand-missing") };
    assert.equal(expandSkillCommand("/skill:pdf", [broken]), null);
  });
});
