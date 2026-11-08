/** 终端服务：工作目录解析（会话 / 显式目录 / 工作区懒建）、每目录上限与几个边界动作 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { ERROR_CODES, TERMINAL_COLS_MAX } from "@ucode/contracts";

import { TERMINAL_MAX_PER_CWD } from "../../../constants/terminal";
import { workspaceDirOf } from "../../../core/workspace";
import type { SessionRecord } from "../../../db/session-repository";
import { env } from "../../../env";
import { AppError } from "../../../platform/response";
import { createTerminalService, type TerminalService } from "..";

const recordOf = (id: string, cwd: string | null): SessionRecord => ({
  id,
  name: null,
  cwd,
  model: null,
  thinkingLevel: null,
  mode: "build",
  permissionMode: null,
  parentSessionId: null,
  agent: null,
  forkedFromId: null,
  goalState: null,
  designPath: null,
  childCount: 0,
  sourcePath: null,
  preview: "",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  pinnedAt: null,
  lastReadAt: null,
  deletedAt: null,
});

/** 只用到 `find`，其余仓储能力与终端无关 */
const sessionsOf = (records: readonly SessionRecord[]) =>
  ({ find: (id: string) => records.find((record) => record.id === id) ?? null }) as never;

const assertAppError = (error: unknown, code: string): void => {
  assert.ok(error instanceof AppError, `预期 AppError，实际 ${String(error)}`);
  assert.equal(error.code, code);
};

describe("终端服务", () => {
  let dir: string;
  let service: TerminalService;

  before(() => {
    dir = mkdtempSync(join(tmpdir(), "terminal-service-test-"));
    service = createTerminalService({ sessions: sessionsOf([]) });
  });

  after(() => {
    service.disposeAll();
    rmSync(dir, { recursive: true, force: true });
  });

  it("按显式目录创建，并把目录归一成真实路径", () => {
    const info = service.create({ cwd: dir, cols: 80, rows: 24 });
    assert.equal(info.cwd, realpathSync(dir));
    assert.equal(info.running, true);

    // 同一目录的另一种写法（带 ./ 与冗余分隔）归到同一批终端
    const again = service.create({ cwd: join(dir, ".", ""), cols: 80, rows: 24 });
    assert.equal(again.cwd, info.cwd);
    assert.equal(service.list({ cwd: dir }).terminals.length, 2);
  });

  it("按会话 id 解析工作目录", () => {
    const sessionDir = mkdtempSync(join(tmpdir(), "terminal-session-"));
    const scoped = createTerminalService({
      sessions: sessionsOf([recordOf("s-1", sessionDir)]),
    });
    try {
      const info = scoped.create({ sessionId: "s-1", cols: 80, rows: 24 });
      assert.equal(info.cwd, realpathSync(sessionDir));
      assert.equal(scoped.list({ sessionId: "s-1" }).terminals.length, 1);
    } finally {
      scoped.disposeAll();
      rmSync(sessionDir, { recursive: true, force: true });
    }
  });

  it("未绑定目录的会话落在它的工作区，目录缺失时建出来", () => {
    const sessionId = `terminal-test-${Date.now()}`;
    const workspace = workspaceDirOf(sessionId, env.workspacesDir);
    const scoped = createTerminalService({ sessions: sessionsOf([recordOf(sessionId, null)]) });
    try {
      assert.equal(existsSync(workspace), false);
      const info = scoped.create({ sessionId, cols: 80, rows: 24 });
      assert.equal(info.cwd, realpathSync(workspace));
    } finally {
      scoped.disposeAll();
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("会话不存在时报未找到", () => {
    assert.throws(
      () => service.create({ sessionId: "missing", cols: 80, rows: 24 }),
      (error: unknown) => {
        assertAppError(error, ERROR_CODES.notFound);
        return true;
      },
    );
  });

  it("目录不存在时报路径不存在，且不新建用户目录", () => {
    const missing = join(dir, "nope", "deeper");
    assert.throws(
      () => service.create({ cwd: missing, cols: 80, rows: 24 }),
      (error: unknown) => {
        assertAppError(error, ERROR_CODES.pathNotFound);
        return true;
      },
    );
    assert.equal(existsSync(join(dir, "nope")), false);
  });

  it("目录位给了文件时报不可用", () => {
    const file = join(dir, "a-file.txt");
    assert.throws(
      () => service.create({ cwd: file, cols: 80, rows: 24 }),
      (error: unknown) => {
        assertAppError(error, ERROR_CODES.pathNotFound);
        return true;
      },
    );
  });

  it("尺寸超出取值域时夹取，不报错", () => {
    const info = service.create({ cwd: dir, cols: 99_999, rows: 99_999 });
    assert.equal(info.cols, TERMINAL_COLS_MAX);
  });

  it("超过每个目录的上限即拒绝", () => {
    const capped = mkdtempSync(join(tmpdir(), "terminal-cap-"));
    mkdirSync(capped, { recursive: true });
    const scoped = createTerminalService({ sessions: sessionsOf([]) });
    try {
      for (let index = 0; index < TERMINAL_MAX_PER_CWD; index += 1) {
        scoped.create({ cwd: capped, cols: 80, rows: 24 });
      }
      assert.throws(
        () => scoped.create({ cwd: capped, cols: 80, rows: 24 }),
        (error: unknown) => {
          assertAppError(error, ERROR_CODES.terminalLimit);
          return true;
        },
      );
    } finally {
      scoped.disposeAll();
      rmSync(capped, { recursive: true, force: true });
    }
  });

  it("写入不存在的终端只是 false，关闭则是幂等的 false", () => {
    // 输入走 WebSocket 上行：连接已建立时终端随时可能刚退出，这里不该抛错
    assert.equal(service.write("nope", "x"), false);
    assert.throws(
      () => service.resize({ terminalId: "nope", cols: 80, rows: 24 }),
      (error: unknown) => {
        assertAppError(error, ERROR_CODES.terminalNotFound);
        return true;
      },
    );
    assert.deepEqual(service.close({ terminalId: "nope" }), { closed: false });
  });

  it("握手票：一次性、绑终端，重放换不到第二次连接", () => {
    // 独立目录与独立实例：上限按目录算，别撞上前面用例攒下的终端
    const ticketDir = mkdtempSync(join(tmpdir(), "terminal-ticket-"));
    const scoped = createTerminalService({ sessions: sessionsOf([]) });
    try {
      const info = scoped.create({ cwd: ticketDir, cols: 80, rows: 24 });
      const issued = scoped.issueTicket(info.id);
      assert.ok(issued);
      assert.ok(issued.expiresAt > new Date().toISOString());

      // 预检不消耗：中间件放行之后，路由还能核销同一张票
      assert.equal(scoped.peekTicket(issued.ticket, info.id), true);
      assert.equal(scoped.peekTicket(issued.ticket, "another-terminal"), false);
      assert.equal(scoped.peekTicket("no-such-ticket", info.id), false);

      // 核销一次拿到终端 id；再核销同一张票就失效了
      assert.equal(scoped.redeemTicket(issued.ticket), info.id);
      assert.equal(scoped.redeemTicket(issued.ticket), null);
      assert.equal(scoped.peekTicket(issued.ticket, info.id), false);

      // 终端不存在时签不出票
      assert.equal(scoped.issueTicket("missing"), null);
    } finally {
      scoped.disposeAll();
      rmSync(ticketDir, { recursive: true, force: true });
    }
  });

  it("列举一个还没建目录的目标时给空列表，不报错", () => {
    assert.deepEqual(service.list({ cwd: join(dir, "never-created") }), { terminals: [] });
  });

  it("关闭后从列举里消失，快照与订阅都取不到", () => {
    const info = service.create({ cwd: dir, cols: 80, rows: 24 });
    assert.ok(service.snapshot(info.id));
    assert.ok(service.subscribe(info.id, { onData: () => {}, onExit: () => {} }));

    assert.deepEqual(service.close({ terminalId: info.id }), { closed: true });
    assert.equal(service.get(info.id), null);
    assert.equal(service.snapshot(info.id), null);
    assert.equal(service.subscribe(info.id, { onData: () => {}, onExit: () => {} }), null);
    assert.ok(!service.list({ cwd: dir }).terminals.some((item) => item.id === info.id));
  });
});
