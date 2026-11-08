/**
 * 设计稿的落点与命名：新稿按标题起名（重名不覆盖），文件里不带会话信息。
 * 全部跑在临时目录上。
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";

import { PROJECT_CONFIG_DIRNAME } from "../../../../constants/dirs";
import {
  defaultDesignPath,
  designDirOf,
  listProjectDesignFiles,
  slugOfDesignTitle,
} from "../paths";

const dirs: string[] = [];

after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

const tempCwd = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "design-paths-"));
  dirs.push(dir);
  return dir;
};

/** 造一份空壳稿子（内容不参与命名判定） */
const writeDoc = (cwd: string, name: string, title = ""): string => {
  const path = join(designDirOf(cwd), name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ format: 1, meta: { title }, nodes: [] }), "utf8");
  return path;
};

describe("文件名", () => {
  it("保留中文，把会破坏文件名的字符折成短横", () => {
    assert.equal(slugOfDesignTitle("音乐 App 首页"), "音乐-App-首页");
    assert.equal(slugOfDesignTitle("我的/资料:卡"), "我的-资料-卡");
    assert.equal(slugOfDesignTitle("  ...  "), "设计稿");
    assert.equal(slugOfDesignTitle(null), "设计稿");
    assert.equal(slugOfDesignTitle("   "), "设计稿");
  });

  it("太长按长度截断，且不留结尾的短横与点", () => {
    const slug = slugOfDesignTitle(`${"很长的标题".repeat(20)}`);
    assert.ok(slug.length <= 40, slug);
    assert.ok(!slug.endsWith("-"), slug);
  });
});

describe("新稿的落点", () => {
  it("按标题起名", async () => {
    const cwd = tempCwd();
    const path = await defaultDesignPath({ cwd, title: "音乐 App 首页" });
    assert.equal(path, join(designDirOf(cwd), "音乐-App-首页.design"));
  });

  it("重名不复用也不覆盖：后面加序号", async () => {
    const cwd = tempCwd();
    writeDoc(cwd, "设计稿.design");
    assert.equal(
      await defaultDesignPath({ cwd, title: "设计稿" }),
      join(designDirOf(cwd), "设计稿-2.design"),
    );
    writeDoc(cwd, "设计稿-2.design");
    assert.equal(
      await defaultDesignPath({ cwd, title: "设计稿" }),
      join(designDirOf(cwd), "设计稿-3.design"),
    );
  });

  it("没有标题也能落一份", async () => {
    const cwd = tempCwd();
    assert.equal(await defaultDesignPath({ cwd }), join(designDirOf(cwd), "设计稿.design"));
  });
});

describe("目录", () => {
  it("落在项目的配置目录下", () => {
    assert.equal(
      designDirOf("/tmp/project"),
      join("/tmp/project", PROJECT_CONFIG_DIRNAME, "design"),
    );
  });
});

describe("列项目里的稿子", () => {
  it("找到任意位置的 .design，跳过依赖与版本库目录", async () => {
    const cwd = tempCwd();
    writeDoc(cwd, "a.design");
    mkdirSync(join(cwd, "designs"), { recursive: true });
    writeDoc(join(cwd, "designs"), "b.design");
    // 这些目录里的稿子不算项目里的
    mkdirSync(join(cwd, "node_modules/pkg"), { recursive: true });
    writeDoc(join(cwd, "node_modules/pkg"), "vendor.design");
    mkdirSync(join(cwd, ".git"), { recursive: true });
    writeDoc(join(cwd, ".git"), "ref.design");

    const { files } = await listProjectDesignFiles(cwd);
    assert.deepEqual(files.map((file) => file.name).sort(), ["a.design", "b.design"]);
  });
});
