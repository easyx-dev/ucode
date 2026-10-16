/** harness/features/memory：项目级覆盖优先于全局开关 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

import { MemoryService } from "..";

const created: string[] = [];

const makeService = (
  globalEnabled: boolean,
  override: (cwd: string) => boolean | null = () => null,
) => {
  const appDir = mkdtempSync(join(tmpdir(), "memory-enabled-"));
  created.push(appDir);
  return new MemoryService(() => ({ enabled: globalEnabled }), appDir, override);
};

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("MemoryService.enabledFor", () => {
  it("未设项目覆盖时跟随全局开关", () => {
    assert.equal(makeService(true).enabledFor("/work/a"), true);
    assert.equal(makeService(false).enabledFor("/work/a"), false);
  });

  it("项目覆盖双向生效：全局关着也能为某个项目单开，反之亦然", () => {
    const on = makeService(false, (cwd) => (cwd === "/work/a" ? true : null));
    assert.equal(on.enabledFor("/work/a"), true);
    assert.equal(on.enabledFor("/work/b"), false);

    const off = makeService(true, (cwd) => (cwd === "/work/a" ? false : null));
    assert.equal(off.enabledFor("/work/a"), false);
    assert.equal(off.enabledFor("/work/b"), true);
  });
});
