/** harness/plugins/marketplace：清单位置的三档识别与解析 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

import {
  findMarketplaceFile,
  parseMarketplaceCatalog,
  readMarketplaceCatalog,
} from "../marketplace";

const created: string[] = [];

const makeDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "market-"));
  created.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("findMarketplaceFile", () => {
  it("按 本品牌 > zcode > claude 找清单，都没有再看仓根", () => {
    const root = makeDir();
    assert.equal(findMarketplaceFile(root), join(root, "marketplace.json"));

    mkdirSync(join(root, ".claude-plugin"), { recursive: true });
    writeFileSync(join(root, ".claude-plugin", "marketplace.json"), "{}", "utf8");
    assert.equal(findMarketplaceFile(root), join(root, ".claude-plugin", "marketplace.json"));

    mkdirSync(join(root, ".zcode-plugin"), { recursive: true });
    writeFileSync(join(root, ".zcode-plugin", "marketplace.json"), "{}", "utf8");
    assert.equal(findMarketplaceFile(root), join(root, ".zcode-plugin", "marketplace.json"));
  });
});

describe("parseMarketplaceCatalog", () => {
  it("条目里缺少 name 的只跳过那一条并出诊断", () => {
    const catalog = parseMarketplaceCatalog(
      JSON.stringify({
        name: "my-market",
        plugins: [{ name: "a", description: "说明", version: "1.2.3" }, { nope: 1 }],
      }),
      "fallback",
      "test",
    );

    assert.equal(catalog.name, "my-market");
    assert.deepEqual(catalog.entries, [{ name: "a", description: "说明", version: "1.2.3" }]);
    assert.match(catalog.diagnostics[0]?.message ?? "", /缺少 name/);
  });

  it("清单名缺省时回落登记名；形状不对抛错", () => {
    const catalog = parseMarketplaceCatalog(JSON.stringify({ plugins: [] }), "fallback", "test");
    assert.equal(catalog.name, "fallback");

    assert.throws(() => parseMarketplaceCatalog("{oops", "fallback", "test"), /市场清单无效/);
    assert.throws(
      () => parseMarketplaceCatalog(JSON.stringify({ plugins: {} }), "fallback", "test"),
      /市场清单无效/,
    );
  });
});

describe("readMarketplaceCatalog", () => {
  it("能从 .claude-plugin 下读到（Claude 官方市场的形状）", () => {
    const root = makeDir();
    mkdirSync(join(root, ".claude-plugin"), { recursive: true });
    writeFileSync(
      join(root, ".claude-plugin", "marketplace.json"),
      JSON.stringify({ plugins: [{ name: "hello" }] }),
      "utf8",
    );

    const catalog = readMarketplaceCatalog(root, "claude-plugins-official");
    assert.deepEqual(catalog.entries, [{ name: "hello", description: "", version: "0.0.0" }]);
    assert.equal(catalog.name, "claude-plugins-official");
  });

  it("文件不存在时报市场无效，而不是抛底层 fs 错误", () => {
    assert.throws(() => readMarketplaceCatalog(makeDir(), "x"), /市场清单无效/);
  });
});
