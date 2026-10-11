/** services/projects：项目默认值的补缺、写回与可用性回落 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import type { ProjectSummary } from "@ucode/contracts";
import { openDatabase } from "../../../db";
import { ProjectRepository } from "../../../db/project-repository";
import { ProjectService } from "..";

const created: string[] = [];
const WORKSPACES = "/home/assistant/workspace";

const makeService = (onChange?: (projects: ProjectSummary[]) => void) => {
  const root = mkdtempSync(join(tmpdir(), "project-service-"));
  created.push(root);
  const db = openDatabase(join(root, "app.db"));
  const repository = new ProjectRepository(db);
  const service = new ProjectService({
    repository,
    // 只有一个模型可用、只有两个内置模式存在，其余按「已删除」处理
    isModelUsable: (ref) => ref === "p/ok",
    hasMode: (_cwd, mode) => mode === "build" || mode === "plan",
    workspacesDir: WORKSPACES,
    ...(onChange ? { onChange } : {}),
  });
  return { service, repository, close: () => db.close() };
};

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("ProjectService.seedFor", () => {
  it("请求里给的优先，缺的用项目记住的值补", () => {
    const env = makeService();
    try {
      env.service.remember("/work/a", {
        model: "p/ok",
        thinkingLevel: "xhigh",
        mode: "plan",
        permissionMode: "auto",
      });

      assert.deepEqual(env.service.seedFor("/work/a", { model: "p/other" }), {
        model: "p/other",
        thinkingLevel: "xhigh",
        mode: "plan",
        permissionMode: "auto",
      });
    } finally {
      env.close();
    }
  });

  it("没有对应项目行时原样返回请求里的初始设置", () => {
    const env = makeService();
    try {
      assert.deepEqual(env.service.seedFor("/work/none", { mode: "ask" }), { mode: "ask" });
      assert.deepEqual(env.service.seedFor(undefined, {}), {});
    } finally {
      env.close();
    }
  });

  it("助理工作区与相对路径写法都按同一口径归一后判定", () => {
    const env = makeService();
    try {
      // 工作区目录下的会话不算项目：写回不建行、补缺也不生效
      env.service.remember(`${WORKSPACES}/s1`, { mode: "plan" });
      assert.equal(env.repository.list().length, 0);

      // 归一化后的路径才是项目的键
      env.service.remember("/work/../work/a", { mode: "plan" });
      assert.deepEqual(env.service.seedFor("/work/a", {}), { mode: "plan" });
    } finally {
      env.close();
    }
  });

  it("已不可用的模型与模式按未设置回落，不阻断建会话", () => {
    const env = makeService();
    try {
      env.service.remember("/work/a", { model: "p/gone", mode: "gone" });
      assert.deepEqual(env.service.seedFor("/work/a", {}), {});
      assert.equal(env.service.list()[0]?.model, null);
      assert.equal(env.service.list()[0]?.mode, null);
    } finally {
      env.close();
    }
  });

  it("行里的非法枚举值按未设置处理", () => {
    const env = makeService();
    try {
      env.repository.rememberDefaults("/work/a", {
        model: "p/ok",
        // 绕过服务层的类型约束，模拟脏数据 / 旧版本写入的值
        thinkingLevel: "ultra" as never,
        permissionMode: "yolo" as never,
      });

      assert.deepEqual(env.service.seedFor("/work/a", {}), { model: "p/ok" });
      assert.equal(env.service.list()[0]?.thinkingLevel, null);
      assert.equal(env.service.list()[0]?.permissionMode, null);
    } finally {
      env.close();
    }
  });
});

describe("ProjectService.remember", () => {
  it("只覆盖这次给到的字段，其余保持原值", () => {
    const env = makeService();
    try {
      env.service.remember("/work/a", { mode: "plan" });
      env.service.remember("/work/a", { thinkingLevel: "low" });

      assert.deepEqual(env.service.seedFor("/work/a", {}), {
        mode: "plan",
        thinkingLevel: "low",
      });
    } finally {
      env.close();
    }
  });

  it("没有显式参数时只登记一行", () => {
    const env = makeService();
    try {
      env.service.remember("/work/a", {});
      const records = env.repository.list();
      assert.equal(records.length, 1);
      assert.equal(records[0]?.path, "/work/a");
      assert.equal(records[0]?.model, null);
    } finally {
      env.close();
    }
  });

  it("写入后广播一次，不归项目的目录不广播", () => {
    const seen: ProjectSummary[][] = [];
    const env = makeService((projects) => seen.push(projects));
    try {
      env.service.remember(`${WORKSPACES}/s1`, { mode: "plan" });
      assert.equal(seen.length, 0);

      env.service.remember("/work/a", { mode: "plan" });
      env.service.rename("/work/a", "甲");
      assert.equal(seen.length, 2);
      assert.equal(seen[1]?.length, 1);
      assert.equal(seen[1]?.[0]?.path, "/work/a");
      assert.equal(seen[1]?.[0]?.name, "甲");
      assert.equal(seen[1]?.[0]?.mode, "plan");
    } finally {
      env.close();
    }
  });
});

describe("ProjectService.reconcile", () => {
  it("只留还有会话引用的行，待保留路径按同一口径归一", () => {
    const env = makeService();
    try {
      env.service.remember("/work/alive", { mode: "plan" });
      env.service.rename("/work/gone", "已经不用的");

      assert.deepEqual(env.service.reconcile(["/work/./alive"]), ["/work/gone"]);
      assert.deepEqual(
        env.service.list().map((project) => project.path),
        ["/work/alive"],
      );
    } finally {
      env.close();
    }
  });
});

describe("ProjectService.rename", () => {
  it("改名对还没有行目录也生效", () => {
    const env = makeService();
    try {
      assert.equal(env.service.rename("/work/new", "新项目").name, "新项目");
      assert.equal(env.service.rename("/work/new", null).name, null);
    } finally {
      env.close();
    }
  });

  it("助理工作区不是项目，改名直接 400", () => {
    const env = makeService();
    try {
      assert.throws(() => env.service.rename(`${WORKSPACES}/s1`, "助理"), /不是项目目录/);
    } finally {
      env.close();
    }
  });
});
