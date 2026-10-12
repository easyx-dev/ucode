/**
 * /api/v1/commands 路由集成：只验「插件资产按哪个 cwd 取」这一条——
 * 生效开关是按工作目录算的，传错 cwd 会让 `/` 菜单出现该仓库已经关掉的技能。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { API_BASE_PATH } from "@ucode/contracts";
import { Hono } from "hono";
import { AppError } from "../../../platform/response";
import type { Services } from "../../../services";
import { createCommandsRoute } from "..";

const makeApp = (options: { sessionCwd?: string; explicitCwd?: string; cwd?: string } = {}) => {
  const seen: (string | undefined)[] = [];
  const services = {
    sessions: {
      find: (id: string) =>
        id === "s1" && options.sessionCwd
          ? { id: "s1", cwd: options.sessionCwd, parentSessionId: null }
          : undefined,
    },
    plugins: {
      commandAssets: (cwd?: string) => {
        seen.push(cwd);
        return { skills: [], prompts: [] };
      },
    },
  } as unknown as Services;

  const app = new Hono();
  app.route(`${API_BASE_PATH}/commands`, createCommandsRoute(services));
  app.onError((error, c) => {
    if (error instanceof AppError) return c.json({ code: error.code }, 400);
    throw error;
  });
  return { app, seen };
};

const list = async (app: Hono, body: Record<string, unknown>): Promise<number> => {
  const response = await app.request(`${API_BASE_PATH}/commands/list`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return response.status;
};

describe("/api/v1/commands/list 的 cwd 传递", () => {
  it("按会话的工作目录取插件资产（与会话装配同一个 cwd）", async () => {
    const { app, seen } = makeApp({ sessionCwd: "/tmp/project" });
    assert.equal(await list(app, { sessionId: "s1" }), 200);
    assert.deepEqual(seen, ["/tmp/project"]);
  });

  it("没有会话时用显式 cwd", async () => {
    const { app, seen } = makeApp();
    await list(app, { cwd: "/tmp/other" });
    assert.deepEqual(seen, ["/tmp/other"]);
  });

  it("两个都没有时回落到助理工作区（不是 undefined）", async () => {
    const { app, seen } = makeApp();
    await list(app, {});
    assert.equal(seen.length, 1);
    assert.equal(typeof seen[0], "string");
    assert.notEqual(seen[0], undefined);
  });
});
