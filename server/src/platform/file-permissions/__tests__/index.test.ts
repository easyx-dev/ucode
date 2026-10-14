/** platform/file-permissions：把放宽的权限收紧到「仅属主可读写」 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

import { hardenOwnerOnly, OWNER_ONLY_MODE } from "..";

const created: string[] = [];

const makeFile = (mode: number): string => {
  const dir = mkdtempSync(join(tmpdir(), "file-permissions-"));
  created.push(dir);
  const path = join(dir, "secret.json");
  writeFileSync(path, "{}", { encoding: "utf8", mode });
  return path;
};

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("hardenOwnerOnly", () => {
  it("把放宽的权限收紧到仅属主可读写", () => {
    const path = makeFile(0o644);
    hardenOwnerOnly(path);
    // Windows 上权限落在 ACL 而不是 mode 上，这里只能确认调用不抛（ACL 效果由 Windows 侧实测覆盖）
    if (process.platform === "win32") return;
    assert.equal(statMode(path), OWNER_ONLY_MODE);
  });

  it("文件不存在时不抛：权限收紧失败不该拖垮调用方", () => {
    assert.doesNotThrow(() => hardenOwnerOnly(join(tmpdir(), "file-permissions-missing")));
  });
});

const statMode = (path: string): number => statSync(path).mode & 0o777;
