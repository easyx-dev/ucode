/** harness/attachment：内容寻址附件库（文件 + SQLite 元数据） */
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

import { openDatabase } from "../../../db";
import { AttachmentRepository } from "../../../db/attachment-repository";
import { expireTempAttachments, putAttachment, resolveAttachment } from "../index";

const created: string[] = [];

/** 建一个隔离的临时环境：库文件与附件目录都在临时目录下 */
const makeEnv = () => {
  const root = mkdtempSync(join(tmpdir(), "att-test-"));
  created.push(root);
  const db = openDatabase(join(root, "app.db"));
  return {
    dir: join(root, "attachments"),
    repo: new AttachmentRepository(db),
    close: () => db.close(),
  };
};

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("附件库", () => {
  it("内容寻址：同内容只落一份并可按 id 取回", () => {
    const env = makeEnv();
    try {
      const bytes = Buffer.from("hello attachment");
      const first = putAttachment(bytes, { mimeType: "image/png", name: "a.png" }, env);
      const second = putAttachment(bytes, { mimeType: "image/png", name: "b.png" }, env);

      assert.equal(first.id, second.id);
      // 已存在时返回既有记录，文件名以先入库的为准
      assert.equal(second.name, "a.png");
      assert.ok(existsSync(join(env.dir, first.id)));

      const resolved = resolveAttachment(first.id, env);
      assert.equal(resolved?.path, join(env.dir, first.id));
      assert.equal(resolved?.mimeType, "image/png");
      assert.equal(resolved?.size, bytes.length);
    } finally {
      env.close();
    }
  });

  it("非图片原样入库，mimeType 完整保留", () => {
    const env = makeEnv();
    try {
      const record = putAttachment(
        Buffer.from("%PDF-1.4"),
        { mimeType: "application/pdf", name: "report.pdf" },
        env,
      );
      const resolved = resolveAttachment(record.id, env);
      assert.equal(resolved?.mimeType, "application/pdf");
      assert.equal(resolved?.name, "report.pdf");
    } finally {
      env.close();
    }
  });

  it("非法 id 或不存在返回 null", () => {
    const env = makeEnv();
    try {
      assert.equal(resolveAttachment("not-hex", env), null);
      assert.equal(resolveAttachment("a".repeat(64), env), null);
    } finally {
      env.close();
    }
  });

  it("文件缺失时按未找到处理", () => {
    const env = makeEnv();
    try {
      const record = putAttachment(Buffer.from("x"), { mimeType: "image/png" }, env);
      rmSync(join(env.dir, record.id), { force: true });
      assert.equal(resolveAttachment(record.id, env), null);
    } finally {
      env.close();
    }
  });

  it("expireTempAttachments 删除未引用的临时附件（元数据 + 文件）", () => {
    const env = makeEnv();
    try {
      const record = putAttachment(Buffer.from("temp"), { mimeType: "image/png" }, env);
      assert.ok(existsSync(join(env.dir, record.id)));

      const removed = expireTempAttachments(env, new Date(Date.now() + 1000).toISOString());
      assert.equal(removed, 1);
      assert.equal(resolveAttachment(record.id, env), null);
      assert.equal(existsSync(join(env.dir, record.id)), false);
    } finally {
      env.close();
    }
  });

  it("被消息引用过的附件不会被清理", () => {
    const env = makeEnv();
    try {
      const record = putAttachment(Buffer.from("keep"), { mimeType: "image/png" }, env);
      env.repo.markReferenced([record.id], new Date().toISOString());

      const removed = expireTempAttachments(env, new Date(Date.now() + 1000).toISOString());
      assert.equal(removed, 0);
      assert.ok(resolveAttachment(record.id, env));
    } finally {
      env.close();
    }
  });
});
