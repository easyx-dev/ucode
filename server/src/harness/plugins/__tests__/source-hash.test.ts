/** harness/plugins/source-hash：目录内容哈希的稳定性、变更检测与上限 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

import { PLUGIN_HASH_MAX_FILES } from "../../../constants/plugins";
import { hashDirectory } from "../source-hash";

const created: string[] = [];

const makeDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "plugin-hash-"));
  created.push(dir);
  return dir;
};

const write = (root: string, relative: string, content: string): void => {
  const path = join(root, relative);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content, "utf8");
};

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("hashDirectory", () => {
  it("同样内容得同样的哈希，内容或路径变化都会变", () => {
    const root = makeDir();
    write(root, "plugin.json", "{}");
    write(root, "skills/review/SKILL.md", "正文");
    const first = hashDirectory(root);
    assert.ok(first);
    assert.deepEqual(hashDirectory(root)?.hash, first.hash);

    write(root, "skills/review/SKILL.md", "改过的正文");
    assert.notEqual(hashDirectory(root)?.hash, first.hash);

    write(root, "skills/review/README.md", "新文件");
    assert.notEqual(hashDirectory(root)?.hash, first.hash);
  });

  it("跳过 .git 与 node_modules：它们与插件内容无关", () => {
    const root = makeDir();
    write(root, "plugin.json", "{}");
    const before = hashDirectory(root)?.hash;

    write(root, ".git/HEAD", "ref: refs/heads/main");
    write(root, "node_modules/pkg/index.js", "module.exports = 1");
    assert.equal(hashDirectory(root)?.hash, before);
  });

  it("文件数超限时返回 null（这次不判定，而不是给出半截结论）", () => {
    const root = makeDir();
    for (let index = 0; index <= PLUGIN_HASH_MAX_FILES; index += 1) {
      write(root, `files/${index}.txt`, "x");
    }
    assert.equal(hashDirectory(root), null);
  });

  it("目录不存在时返回 null", () => {
    assert.equal(hashDirectory(join(makeDir(), "nope")), null);
  });
});
