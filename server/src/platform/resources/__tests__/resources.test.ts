/** platform/resources：资源根定位（源码树与安装包靠同一个清单标记） */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

import { findResourceRoot } from "..";

const created: string[] = [];

/** 临时目录树：避免碰到真实文件系统里别的标记 */
const layout = (): string => {
  const root = mkdtempSync(join(tmpdir(), "resources-"));
  created.push(root);
  return root;
};

const writeManifest = (dir: string, manifest: Record<string, unknown>): void => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify(manifest), "utf8");
};

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("findResourceRoot", () => {
  it("取最近的标记：包自己的清单比它所在的项目更近", () => {
    const root = layout();
    const project = join(root, "proj");
    const pkg = join(project, "node_modules", "@scope", "pkg");
    writeManifest(project, { name: "proj", resourceRoot: true });
    writeManifest(pkg, { name: "@scope/pkg", resourceRoot: true });

    assert.equal(findResourceRoot(join(pkg, "dist")), pkg);
    assert.equal(findResourceRoot(project), project);
  });

  it("没有标记（装进别人的项目、清单不是 JSON）时返回 undefined，由调用方回落", () => {
    const root = layout();
    const pkg = join(root, "proj", "node_modules", "pkg");
    writeManifest(pkg, { name: "pkg" });
    assert.equal(findResourceRoot(join(pkg, "dist")), undefined);

    writeFileSync(join(pkg, "package.json"), "{ 不是合法 JSON", "utf8");
    assert.equal(findResourceRoot(pkg), undefined);
  });

  it("标记只看字面 true：写别的值不当成资源根", () => {
    const root = layout();
    writeManifest(root, { name: "pkg", resourceRoot: "yes" });
    assert.equal(findResourceRoot(root), undefined);
  });
});
