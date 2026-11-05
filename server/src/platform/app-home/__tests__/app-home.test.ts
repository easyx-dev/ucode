/** platform/app-home：环境文件的选取顺序与随包默认配置的完整性 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, it } from "node:test";

import { resourceRoot } from "../../resources";
import { planEnvFiles } from "..";

const created: string[] = [];

const layout = (): string => {
  const root = mkdtempSync(join(tmpdir(), "app-home-"));
  created.push(root);
  return root;
};

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const DEFAULTS = resolve(resourceRoot, "defaults/default.conf");

describe("planEnvFiles", () => {
  it("找到的环境文件在前、随包默认在后：先加载的那份说了算", () => {
    const root = layout();
    const project = join(root, "proj");
    const nested = join(project, "src", "deep");
    mkdirSync(nested, { recursive: true });
    // `.env.prod` 在祖先目录也能找到：从 cwd 向上逐级查
    const envFile = join(project, ".env.prod");
    writeFileSync(envFile, "APP_HOME=~/brand-home\n", "utf8");

    const plan = planEnvFiles({
      cwd: nested,
      envFile: ".env.prod",
      sourceTree: false,
      defaultsPath: DEFAULTS,
    });

    assert.equal(plan.envFile, envFile);
    assert.deepEqual(plan.files, [envFile, DEFAULTS]);
  });

  it("源码树里不加载随包默认：那边漏写环境文件就该失败，而不是落到默认主目录", () => {
    const root = layout();
    const plan = planEnvFiles({
      cwd: root,
      envFile: ".env.prod",
      sourceTree: true,
      defaultsPath: DEFAULTS,
    });

    assert.equal(plan.envFile, null);
    assert.deepEqual(plan.files, []);
  });

  it("安装包形态没有环境文件时只剩随包默认这一档", () => {
    const root = layout();
    const plan = planEnvFiles({
      cwd: root,
      envFile: ".env.prod",
      sourceTree: false,
      defaultsPath: DEFAULTS,
    });

    assert.equal(plan.envFile, null);
    assert.deepEqual(plan.files, [DEFAULTS]);
  });
});

describe("随包默认配置", () => {
  it("覆盖服务启动必需的全部变量（少一项，安装后起不来）", () => {
    const keys = new Set(
      [...readFileSync(DEFAULTS, "utf8").matchAll(/^([A-Z0-9_]+)=/gm)].map((match) => match[1]),
    );
    for (const name of [
      "APP_HOME",
      "APP_HOST",
      "APP_PORT",
      "APP_POOL_IDLE_MS",
      "APP_LOG_LEVEL",
      "APP_PROMPT_SOURCE",
    ]) {
      assert.ok(keys.has(name), `defaults/default.conf 缺少 ${name}`);
    }
  });
});
