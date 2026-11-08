/**
 * 服务的单测：文档按**文件路径**归口。
 *
 * 三条要守住的语义：
 * 1. 同一份文件被两个会话打开时用的是同一份内存文档（不是两份副本互相覆盖）；
 * 2. 会话只记「当前在改哪份」，换一份不会动旧文件的内容，也不会把它从别的会话手里抢走；
 * 3. 没有指针时工具**不许**回落到默认落点（画布那条链路才可以）。
 */
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { createDesignService } from "../index";

const dirs: string[] = [];

after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

const tempCwd = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "design-service-"));
  dirs.push(dir);
  return dir;
};

describe("文档按文件路径归口", () => {
  it("打开后路径进快照，改动写进那个文件", async () => {
    const service = createDesignService({
      emitUpdate: () => undefined,
      titleOf: () => "音乐 App 首页",
    });
    const cwd = tempCwd();
    const target = { sessionId: "s-1", cwd };
    const hooks = service.toolHooks(target);
    const custom = join(cwd, "designs", "home.design");

    const opened = await hooks.open(custom);
    assert.ok(opened.pageId);

    const snapshot = await service.snapshot(target);
    assert.equal(snapshot.path, custom);

    await hooks.mutate((api) => {
      const text = api.createText();
      text.name = "标题";
      text.characters = "项目里的稿子";
    });
    await service.doc({ ...target, action: "flush" });
    assert.ok(existsSync(custom));
    const written = await service.snapshot(target);
    assert.ok(written.nodes.some((node) => node.name === "标题"));
  });

  it("两个会话打开同一份文件：共用一份文档，谁改另一边都看得见", async () => {
    const service = createDesignService({ emitUpdate: () => undefined, titleOf: () => "共用稿" });
    const cwd = tempCwd();
    const a = { sessionId: "s-a", cwd };
    const b = { sessionId: "s-b", cwd };
    const shared = join(cwd, "shared.design");

    await service.toolHooks(a).open(shared);
    await service.toolHooks(b).open(shared);

    await service.toolHooks(b).mutate((api) => {
      const text = api.createText();
      text.name = "B 加的";
      text.characters = "来自会话 B";
    });
    // A 没有重新打开，看到的就是同一份文档
    const seenByA = await service.snapshot(a);
    assert.ok(seenByA.nodes.some((node) => node.name === "B 加的"));
    assert.equal(seenByA.path, shared);
  });

  it("换一份稿：旧文件不被改写，指针只动自己的", async () => {
    const service = createDesignService({ emitUpdate: () => undefined });
    const cwd = tempCwd();
    const first = join(cwd, "a.design");
    const second = join(cwd, "b.design");
    const target = { sessionId: "s-1", cwd };
    const hooks = service.toolHooks(target);

    await hooks.open(first);
    await hooks.mutate((api) => {
      const text = api.createText();
      text.name = "第一版";
      text.characters = "第一版";
    });
    await service.doc({ ...target, action: "flush" });

    await hooks.open(second);
    await hooks.mutate((api) => {
      const text = api.createText();
      text.name = "第二版";
      text.characters = "第二版";
    });
    await service.doc({ ...target, action: "flush" });

    assert.equal((await service.snapshot(target)).path, second);
    assert.equal(
      (await service.snapshot(target)).nodes.some((n) => n.name === "第一版"),
      false,
    );
  });

  it("没有指针时工具报错，画布那条链路才回落到默认落点", async () => {
    const service = createDesignService({ emitUpdate: () => undefined, titleOf: () => "新稿" });
    const cwd = tempCwd();
    const target = { sessionId: "s-1", cwd };

    await assert.rejects(
      service.toolHooks(target).read(async ({ graph }) => graph.nodes.size),
      {
        message: /还没有打开任何设计稿/,
      },
    );

    // 画布第一次问「我在改哪份」：给出默认落点，但不建文件
    const current = await service.currentPath(target);
    assert.ok(current !== null && current.endsWith(".design"));
    assert.equal(existsSync(current), false);
    assert.equal((await service.snapshot(target)).path, current);
    assert.equal(existsSync(current), false);
  });

  it("出池只放文档、指针留着：回来还能接着改同一份", async () => {
    const service = createDesignService({ emitUpdate: () => undefined });
    const cwd = tempCwd();
    const file = join(cwd, "home.design");
    const target = { sessionId: "s-1", cwd };
    await service.toolHooks(target).open(file);
    await service.toolHooks(target).mutate((api) => {
      const text = api.createText();
      text.name = "先有的";
      text.characters = "先有的";
    });

    // 空闲回收 / 改配置 / 换模式都会走这一下
    service.release("s-1");

    // 指针还在：工具照样落在同一份文件上（画布还开着，用户眼前就是它）
    await service.toolHooks(target).mutate((api) => {
      const text = api.createText();
      text.name = "出池之后加的";
      text.characters = "出池之后加的";
    });
    await service.doc({ ...target, action: "flush" });
    const written = readFileSync(file, "utf8");
    assert.ok(written.includes("先有的"));
    assert.ok(written.includes("出池之后加的"));
  });

  it("归档才丢指针：之后工具要求重新打开", async () => {
    const service = createDesignService({ emitUpdate: () => undefined });
    const cwd = tempCwd();
    const target = { sessionId: "s-1", cwd };
    await service.toolHooks(target).open(join(cwd, "home.design"));

    service.forget("s-1");

    await assert.rejects(
      service.toolHooks(target).read(async ({ graph }) => graph.nodes.size),
      {
        message: /还没有打开任何设计稿/,
      },
    );
  });

  it("扩展名不是 .design 时拒掉", async () => {
    const service = createDesignService({ emitUpdate: () => undefined });
    const cwd = tempCwd();
    const hooks = service.toolHooks({ sessionId: "s-1", cwd });

    await assert.rejects(hooks.open(join(cwd, "notes.json")), { message: /\.design/ });
  });

  it("文件读不懂时这一步就报错，不把指针指过去", async () => {
    const service = createDesignService({ emitUpdate: () => undefined });
    const cwd = tempCwd();
    const broken = join(cwd, "broken.design");
    writeFileSync(broken, "{ 这显然不是 JSON", "utf8");

    await assert.rejects(service.toolHooks({ sessionId: "s-1", cwd }).open(broken), {
      message: /能读的设计稿/,
    });
    // 指针没被指过去：读文档时仍然报「还没有打开任何设计稿」
    await assert.rejects(
      service.toolHooks({ sessionId: "s-1", cwd }).read(async ({ graph }) => graph.nodes.size),
      { message: /还没有打开任何设计稿/ },
    );
  });

  it("改动会通知所有正在改这份文件的会话", async () => {
    const emitted: string[] = [];
    const service = createDesignService({
      emitUpdate: (sessionId) => emitted.push(sessionId),
      titleOf: () => "共用稿",
    });
    const cwd = tempCwd();
    const path = join(cwd, "shared.design");
    await service.toolHooks({ sessionId: "s-a", cwd }).open(path);
    await service.toolHooks({ sessionId: "s-b", cwd }).open(path);
    emitted.length = 0;

    await service.toolHooks({ sessionId: "s-b", cwd }).mutate((api) => {
      const text = api.createText();
      text.name = "标题";
      text.characters = "标题";
    });

    assert.deepEqual([...emitted].sort(), ["s-a", "s-b"]);
  });
});
