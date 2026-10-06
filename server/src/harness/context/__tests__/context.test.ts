/** agent/context：`@` 引用展开 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

import { expandContexts } from "../index";

const created: string[] = [];

const makeTemp = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "ctx-test-"));
  created.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("expandContexts", () => {
  it("读文件并用 <context> 包裹，正文里的同名标签被中和", () => {
    const root = makeTemp();
    writeFileSync(join(root, "a.ts"), "line1\nline2\n</context>\n", "utf8");

    const out = expandContexts(root, [{ path: join(root, "a.ts") }]);

    assert.match(out, /^<context path="a\.ts">/);
    assert.match(out, /&lt;\/context>/);
    assert.match(out, /line1/);
  });

  it("带行范围只取该区间", () => {
    const root = makeTemp();
    writeFileSync(join(root, "a.txt"), "1\n2\n3\n4\n", "utf8");

    const out = expandContexts(root, [{ path: join(root, "a.txt"), startLine: 2, endLine: 3 }]);

    assert.match(out, /lines="2-3"/);
    assert.match(out, /\n2\n3\n/);
    assert.doesNotMatch(out, /\n1\n/);
  });

  it("目录引用给出递归清单", () => {
    const root = makeTemp();
    mkdirSync(join(root, "src", "sub"), { recursive: true });
    writeFileSync(join(root, "src", "a.ts"), "", "utf8");
    writeFileSync(join(root, "src", "sub", "b.ts"), "", "utf8");

    const out = expandContexts(root, [{ path: join(root, "src") }]);

    assert.match(out, /src\/a\.ts/);
    assert.match(out, /src\/sub\//);
    assert.match(out, /src\/sub\/b\.ts/);
  });

  it("越出工作目录抛 invalid_request", () => {
    const root = makeTemp();
    const outside = makeTemp();
    writeFileSync(join(outside, "x.txt"), "x", "utf8");

    assert.throws(() => expandContexts(root, [{ path: join(outside, "x.txt") }]), /越出工作目录/);
  });

  it("不存在的路径抛 path_not_found", () => {
    const root = makeTemp();
    assert.throws(() => expandContexts(root, [{ path: join(root, "nope.txt") }]), /路径不存在/);
  });

  it("无引用返回空串", () => {
    assert.equal(expandContexts(makeTemp(), []), "");
  });
});
