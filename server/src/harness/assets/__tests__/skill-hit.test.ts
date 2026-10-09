/** harness/assets/skill-hit：技能命中与显式调用的判定 */
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { createSyntheticSourceInfo, type Skill } from "@earendil-works/pi-coding-agent";

import { skillIndexOf } from "../index";
import { matchSkillHit, matchSkillInvoke } from "../skill-hit";

const created: string[] = [];

const makeTemp = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "skill-hit-test-"));
  created.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** 在临时目录里落一个真技能：索引按 realpath 建，文件必须真实存在 */
const skill = (name: string): Skill => {
  const baseDir = makeTemp();
  const filePath = join(baseDir, "SKILL.md");
  writeFileSync(filePath, `---\nname: ${name}\ndescription: 说明\n---\n\n正文\n`, "utf8");
  return {
    name,
    description: "说明",
    filePath,
    baseDir,
    sourceInfo: createSyntheticSourceInfo(filePath, { source: "local", baseDir }),
    disableModelInvocation: false,
  };
};

const indexOf = (skills: Skill[], cwd: string) =>
  skillIndexOf(skills, [{ path: cwd, source: "project" }], cwd);

describe("matchSkillHit", () => {
  it("读技能文件算命中，来源与名字都带出来", () => {
    const review = skill("review");
    const index = indexOf([review], review.baseDir);

    const hit = matchSkillHit("read", { path: review.filePath }, review.baseDir, index);
    assert.equal(hit?.name, "review");
    // 索引把路径归一成 realpath（macOS 的 /var 会解析到 /private/var），记下来的也是它
    assert.equal(hit?.file, realpathSync(review.filePath));
    assert.equal(hit?.source, "project");
  });

  it("相对 cwd 的写法命中同一个技能（索引按 realpath 比对）", () => {
    const review = skill("review");
    const index = indexOf([review], review.baseDir);

    assert.equal(
      matchSkillHit("read", { path: "SKILL.md" }, review.baseDir, index)?.name,
      "review",
    );
  });

  it("非 read 工具、入参非法、路径为空都不算命中", () => {
    const review = skill("review");
    const index = indexOf([review], review.baseDir);

    assert.equal(matchSkillHit("bash", { path: review.filePath }, review.baseDir, index), null);
    assert.equal(matchSkillHit("read", null, review.baseDir, index), null);
    assert.equal(matchSkillHit("read", { path: 42 }, review.baseDir, index), null);
    assert.equal(matchSkillHit("read", { path: "   " }, review.baseDir, index), null);
  });

  it("索引外的同名文件不算命中", () => {
    const indexed = skill("review");
    const outsider = skill("review");
    const index = indexOf([indexed], indexed.baseDir);

    assert.equal(matchSkillHit("read", { path: outsider.filePath }, indexed.baseDir, index), null);
  });
});

describe("matchSkillInvoke", () => {
  it("`/skill:name` 认出来，后面的参数不影响", () => {
    const review = skill("review");
    const index = indexOf([review], review.baseDir);

    assert.equal(matchSkillInvoke("/skill:review 看看这个", index)?.name, "review");
    assert.equal(matchSkillInvoke("/skill:review", index)?.name, "review");
  });

  it("普通输入与索引里没有的名字都返回 null", () => {
    const review = skill("review");
    const index = indexOf([review], review.baseDir);

    assert.equal(matchSkillInvoke("看看这个", index), null);
    assert.equal(matchSkillInvoke("/skill:unknown x", index), null);
  });
});
