/** harness/plugins/builtin：内置资产注册表与技能物化 */
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

import {
  type BuiltinAsset,
  builtinPromptCommands,
  PACKAGED_BUILTIN_ASSETS,
  resolveBuiltinAssets,
} from "..";
import { hashBuiltinFiles, materializeBuiltinAssets } from "../materialize";

const created: string[] = [];

const makeDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "builtin-assets-"));
  created.push(dir);
  return dir;
};

const skill = (
  over: Partial<Extract<BuiltinAsset, { kind: "skill" }>> = {},
): Extract<BuiltinAsset, { kind: "skill" }> => ({
  kind: "skill",
  id: over.id ?? "demo-skill",
  description: "演示技能",
  version: over.version ?? "1.0.0",
  files: over.files ?? { "SKILL.md": "---\nname: demo-skill\n---\n正文\n" },
  requiredFiles: over.requiredFiles ?? ["SKILL.md"],
});

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("内置资产注册表", () => {
  it("随包集合含提示词命令与五个内置技能，且与云同步口子同源", () => {
    const assets = resolveBuiltinAssets();
    assert.equal(assets, PACKAGED_BUILTIN_ASSETS, "本轮云同步恒回落随包集合");
    assert.deepEqual(
      assets.filter((asset) => asset.kind === "skill").map((asset) => asset.id),
      ["plugin-create", "plugin-review", "skill-create", "agent-create", "command-create"],
    );
    assert.deepEqual(
      builtinPromptCommands().map((command) => command.name),
      ["review"],
    );
  });
});

describe("materializeBuiltinAssets", () => {
  it("物化技能与状态清单，第二次运行幂等（不写盘）", () => {
    const builtinDir = makeDir();
    const first = materializeBuiltinAssets({
      builtinDir,
      assets: [skill()],
      now: "2026-01-01T00:00:00.000Z",
    });

    assert.equal(first.skillsDir, join(builtinDir, "skills"));
    assert.equal(first.written, 2, "SKILL.md + manifest.json");
    assert.deepEqual(first.diagnostics, []);
    assert.ok(existsSync(join(first.skillsDir, "demo-skill", "SKILL.md")));

    const manifest = JSON.parse(readFileSync(join(builtinDir, "manifest.json"), "utf8")) as {
      assets: {
        id: string;
        kind: string;
        version: string;
        origin: string;
        sha256: string;
        executable: boolean;
        active: boolean;
      }[];
    };
    assert.deepEqual(manifest.assets, [
      {
        id: "demo-skill",
        kind: "skill",
        version: "1.0.0",
        origin: "packaged",
        sha256: hashBuiltinFiles(skill().files),
        executable: false,
        active: true,
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ]);

    const second = materializeBuiltinAssets({
      builtinDir,
      assets: [skill()],
      now: "2026-02-02T00:00:00.000Z",
    });
    assert.equal(second.written, 0, "内容没变就不该再写盘");
    const stable = JSON.parse(readFileSync(join(builtinDir, "manifest.json"), "utf8")) as {
      assets: { updatedAt: string }[];
    };
    assert.equal(stable.assets[0]?.updatedAt, "2026-01-01T00:00:00.000Z", "时间戳也不该刷新");
  });

  it("内容变化按内容覆盖（路径不变）", () => {
    const builtinDir = makeDir();
    materializeBuiltinAssets({ builtinDir, assets: [skill()] });
    const updated = skill({ version: "2.0.0", files: { "SKILL.md": "改过的正文" } });

    const result = materializeBuiltinAssets({ builtinDir, assets: [updated] });
    assert.equal(result.written, 2, "SKILL.md + manifest.json");
    assert.equal(
      readFileSync(join(builtinDir, "skills", "demo-skill", "SKILL.md"), "utf8"),
      "改过的正文",
    );
    const manifest = JSON.parse(readFileSync(join(builtinDir, "manifest.json"), "utf8")) as {
      assets: { version: string }[];
    };
    assert.equal(manifest.assets[0]?.version, "2.0.0");
  });

  it("缺必需文件时拒绝物化：内容与状态清单都保留上一版", () => {
    const builtinDir = makeDir();
    materializeBuiltinAssets({ builtinDir, assets: [skill()] });
    const broken = skill({ files: { "SKILL.md": "新正文", "references/api.md": "文档" } });

    // 先写一版完整的（含 references），再拿缺件的一版去物化
    materializeBuiltinAssets({
      builtinDir,
      assets: [skill({ files: { "SKILL.md": "完整版", "references/api.md": "文档" } })],
    });
    const result = materializeBuiltinAssets({
      builtinDir,
      assets: [
        {
          ...broken,
          files: { "SKILL.md": "半个技能" },
          requiredFiles: ["SKILL.md", "references/api.md"],
        },
      ],
    });

    assert.equal(result.written, 0, "既不写半个技能，也不动上一版的状态记录");
    assert.match(result.diagnostics[0] ?? "", /缺少必需文件 references\/api\.md/);
    const manifest = JSON.parse(readFileSync(join(builtinDir, "manifest.json"), "utf8")) as {
      assets: { id: string; version: string; sha256: string; active: boolean }[];
    };
    assert.equal(manifest.assets.length, 1, "上一版记录仍在");
    assert.equal(
      manifest.assets[0]?.sha256,
      hashBuiltinFiles({ "SKILL.md": "完整版", "references/api.md": "文档" }),
      "记录指向仍在盘上的那一版内容",
    );
    assert.equal(manifest.assets[0]?.active, true);
    assert.equal(
      readFileSync(join(builtinDir, "skills", "demo-skill", "SKILL.md"), "utf8"),
      "完整版",
      "保留上一版可用内容",
    );
    assert.equal(
      readFileSync(join(builtinDir, "skills", "demo-skill", "references", "api.md"), "utf8"),
      "文档",
    );
  });

  it("一个技能都没有时也建出技能目录（装配层按它注入 loader）", () => {
    const builtinDir = join(makeDir(), "nested", "builtin");
    const result = materializeBuiltinAssets({ builtinDir, assets: [] });

    assert.ok(existsSync(result.skillsDir));
    assert.equal(result.written, 1, "只写 manifest.json");
  });

  it("写盘失败只记诊断，不抛异常", () => {
    const builtinDir = makeDir();
    // 用一个同名文件挡住 skills 目录，制造写入失败
    writeFileSync(join(builtinDir, "skills"), "挡住了", "utf8");

    const result = materializeBuiltinAssets({ builtinDir, assets: [skill()] });
    assert.ok(result.diagnostics.length > 0);
    assert.match(result.diagnostics.join("\n"), /写不进去/);
  });
});
