/** /api/v1/assets 路由集成：工作目录口径与 agents / commands 一致（会话 > 显式 cwd > 助理工作区） */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { API_BASE_PATH, ERROR_CODES } from "@ucode/contracts";
import { Hono } from "hono";
import { AppError } from "../../../platform/response";
import type { Services } from "../../../services";
import { createAssetsRoute } from "..";

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
      commandAssets: (cwd?: string) => {
        seen.push(cwd);
        return { skills: [], prompts: [] };
      },
      agentProfiles: () => [],
    },
  } as unknown as Services;

  const app = new Hono();
  app.route(`${API_BASE_PATH}/assets`, createAssetsRoute(services));
  app.onError((error, c) => {
    if (error instanceof AppError) return c.json({ code: error.code }, 400);
    throw error;
  });
  return { app, seen };
};

const post = async (app: Hono, action: string, body: Record<string, unknown>): Promise<number> => {
  const response = await app.request(`${API_BASE_PATH}/assets/${action}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return response.status;
};

describe("/api/v1/assets 的 cwd 传递", () => {
  it("按会话的工作目录取插件资产", async () => {
    const { app, seen } = makeApp("/tmp/project");
    assert.equal(await post(app, "list", { sessionId: "s1" }), 200);
    assert.deepEqual(seen, ["/tmp/project"]);
  });

  it("没有会话时用显式 cwd；都没有则回落助理工作区", async () => {
    const first = makeApp();
    await post(first.app, "list", { cwd: "/tmp/other" });
    assert.deepEqual(first.seen, ["/tmp/other"]);

    const second = makeApp();
    await post(second.app, "list", {});
    assert.equal(typeof second.seen[0], "string");
  });

  it("会话不存在时报 not_found", async () => {
    const { app } = makeApp("/tmp/project");
    const response = await app.request(`${API_BASE_PATH}/assets/list`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: "missing" }),
    });
    // 测试壳把 AppError 统一映成 400，错误码才是真实口径
    assert.equal(response.status, 400);
    const body = (await response.json()) as { code: string };
    assert.equal(body.code, ERROR_CODES.notFound);
  });

  it("路径不在资产目录内时读取返回 400", async () => {
    const { app } = makeApp("/tmp/project");
    assert.equal(await post(app, "read", { kind: "agent", path: "/tmp/nowhere/x.md" }), 400);
  });
});
