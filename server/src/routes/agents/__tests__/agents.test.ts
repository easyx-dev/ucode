/**
 * /api/v1/agents 路由集成：同 commands——插件子角色按该 cwd 的生效开关取，
 * 传错 cwd 会让列表里出现会话里并不存在的角色。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { API_BASE_PATH } from "@ucode/contracts";
import { Hono } from "hono";
import { AppError } from "../../../platform/response";
import type { Services } from "../../../services";
import { createAgentsRoute } from "..";

const makeApp = (sessionCwd?: string) => {
  const seen: (string | undefined)[] = [];
  const services = {
    sessions: {
      find: (id: string) =>
        id === "s1" && sessionCwd
          ? { id: "s1", cwd: sessionCwd, parentSessionId: null }
          : undefined,
    },
    plugins: {
      agentProfiles: (cwd?: string) => {
        seen.push(cwd);
        return [];
      },
    },
  } as unknown as Services;

  const app = new Hono();
  app.route(`${API_BASE_PATH}/agents`, createAgentsRoute(services));
  app.onError((error, c) => {
    if (error instanceof AppError) return c.json({ code: error.code }, 400);
    throw error;
  });
  return { app, seen };
};

const list = async (app: Hono, body: Record<string, unknown>): Promise<number> => {
  const response = await app.request(`${API_BASE_PATH}/agents/list`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return response.status;
};

describe("/api/v1/agents/list 的 cwd 传递", () => {
  it("按会话的工作目录取插件子角色", async () => {
    const { app, seen } = makeApp("/tmp/project");
    assert.equal(await list(app, { sessionId: "s1" }), 200);
    assert.deepEqual(seen, ["/tmp/project"]);
  });

  it("没有会话时用显式 cwd；都没有则回落助理工作区", async () => {
    const first = makeApp();
    await list(first.app, { cwd: "/tmp/other" });
    assert.deepEqual(first.seen, ["/tmp/other"]);

    const second = makeApp();
    await list(second.app, {});
    assert.equal(typeof second.seen[0], "string");
  });
});
