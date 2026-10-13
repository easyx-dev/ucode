/** file-icons：按路径取图标（只验证映射到的图标身份，不关心图形本身） */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  Braces,
  FileCode,
  File as FileDefault,
  FileDiff,
  FileImage,
  FileJson,
  FileLock,
  FileSpreadsheet,
  FileText,
  FileType,
  Settings2,
} from "lucide-react";

import { fileIconOf } from "../file-icons";

describe("fileIconOf", () => {
  it("按扩展名归类", () => {
    assert.equal(fileIconOf("/a/main.ts"), FileCode);
    assert.equal(fileIconOf("/a/app.py"), FileCode);
    assert.equal(fileIconOf("/a/index.html"), FileCode);
    assert.equal(fileIconOf("/a/data.json"), FileJson);
    assert.equal(fileIconOf("/a/README.md"), FileText);
    assert.equal(fileIconOf("/a/settings.yml"), Settings2);
    assert.equal(fileIconOf("/a/schema.xml"), Braces);
    assert.equal(fileIconOf("/a/logo.svg"), FileImage);
    assert.equal(fileIconOf("/a/rows.csv"), FileSpreadsheet);
    assert.equal(fileIconOf("/a/patch.diff"), FileDiff);
    assert.equal(fileIconOf("/a/font.woff2"), FileType);
  });

  it("大小写与无扩展名都处理", () => {
    assert.equal(fileIconOf("/a/MAIN.TS"), FileCode);
    assert.equal(fileIconOf("/a/Dockerfile"), Settings2);
    assert.equal(fileIconOf("/a/.gitignore"), FileLock);
    assert.equal(fileIconOf("/a/LICENSE"), FileLock);
  });

  it("锁文件按文件名判断，认不出的给通用图标", () => {
    assert.equal(fileIconOf("/a/pnpm-lock.yaml"), FileLock);
    assert.equal(fileIconOf("/a/unknown.zzz"), FileDefault);
    assert.equal(fileIconOf("/a/noext"), FileDefault);
  });
});
