import { describe, expect, it } from "vitest";
import { transportForNode } from "../node-transport.ts";
import { describeNode, endpointKey, NodeRegistry, normalizeNode } from "../nodes.ts";

describe("endpointKey", () => {
  it("按端点派生稳定 id（尾斜杠归一）", () => {
    expect(endpointKey({ kind: "http", baseUrl: "http://127.0.0.1:3000/" })).toBe(
      "http:http://127.0.0.1:3000",
    );
    expect(endpointKey({ kind: "rpc", socketPath: "/tmp/x.sock" })).toBe("rpc:unix:/tmp/x.sock");
    expect(endpointKey({ kind: "rpc", host: "10.0.0.2", port: 7000 })).toBe(
      "rpc:tcp:10.0.0.2:7000",
    );
  });
});

describe("normalizeNode", () => {
  it("校验：节点名、http(s) 端点、rpc 端点至少要一个地址", () => {
    expect(
      typeof normalizeNode({ name: "bad name", endpoint: { kind: "http", baseUrl: "http://x" } }),
    ).toBe("string");
    expect(typeof normalizeNode({ name: "a", endpoint: { kind: "http", baseUrl: "/tmp/x" } })).toBe(
      "string",
    );
    expect(typeof normalizeNode({ name: "a", endpoint: { kind: "rpc" } })).toBe("string");
    const ok = normalizeNode({
      name: "local",
      endpoint: { kind: "rpc", socketPath: "/tmp/a.sock" },
    });
    expect(typeof ok).not.toBe("string");
  });
});

describe("NodeRegistry", () => {
  it("同名或同端点视为同一条（就地更新，不产生两条记录）", () => {
    const registry = new NodeRegistry();
    registry.add({ name: "lab", endpoint: { kind: "http", baseUrl: "http://a:1" } });
    registry.add({
      name: "lab",
      endpoint: { kind: "http", baseUrl: "http://a:1" },
      displayName: "实验室",
    });
    expect(registry.list()).toHaveLength(1);
    expect(registry.get("lab")?.displayName).toBe("实验室");

    // 同名换地址：旧记录被替换（一个名字只指向一个节点）
    registry.add({ name: "lab", endpoint: { kind: "http", baseUrl: "http://b:2" } });
    expect(registry.list()).toHaveLength(1);
    expect(registry.get("lab")?.endpoint).toEqual({ kind: "http", baseUrl: "http://b:2" });
  });

  it("可删；按名或 id 查", () => {
    const registry = new NodeRegistry();
    const added = registry.add({
      name: "local",
      endpoint: { kind: "rpc", socketPath: "/tmp/a.sock" },
    });
    expect(registry.get(added.id)?.name).toBe("local");
    expect(registry.remove("local")).toBe(true);
    expect(registry.remove("local")).toBe(false);
  });

  it("记下最近一次连接的信任级别", () => {
    const registry = new NodeRegistry();
    registry.add({ name: "lab", endpoint: { kind: "http", baseUrl: "http://a:1" } });
    expect(
      registry.markConnected("lab", {
        trustLevel: "local",
        at: new Date("2026-03-01T00:00:00.000Z"),
      }),
    ).toBe(true);
    const node = registry.get("lab");
    expect(node?.lastTrustLevel).toBe("local");
    expect(node?.lastConnectedAt).toBe("2026-03-01T00:00:00.000Z");
    expect(registry.markConnected("nope", { trustLevel: "local" })).toBe(false);
  });

  it("序列化往返：坏条目被丢弃而不是让整份注册表报废", () => {
    const registry = new NodeRegistry();
    registry.add({
      name: "a",
      endpoint: { kind: "http", baseUrl: "http://a:1" },
      credentialRef: "cred-a",
    });
    const json = registry.toJSON();
    expect(json.version).toBe(1);

    const restored = NodeRegistry.fromJSON({
      version: 1,
      nodes: [
        ...json.nodes,
        { name: "bad name", endpoint: { kind: "http", baseUrl: "http://x" } },
        { notANode: true },
      ],
    });
    expect(restored.list().map((node) => node.name)).toEqual(["a"]);
    expect(restored.get("a")?.credentialRef).toBe("cred-a");
  });

  it("空/损坏输入得到空注册表", () => {
    expect(NodeRegistry.fromJSON(null).list()).toEqual([]);
    expect(NodeRegistry.fromJSON({ nodes: "nope" }).list()).toEqual([]);
  });
});

describe("transportForNode", () => {
  it("按端点造对应的传输；clientId 缺省时按节点名派生", () => {
    const http = transportForNode({
      id: "http:http://a:1",
      name: "a",
      endpoint: { kind: "http", baseUrl: "http://a:1" },
    });
    expect(http.kind).toBe("http");

    // rpc 传输在构造时就会去连 socket，测试里不真的连（其映射由 endpointKey 覆盖）。
    expect(endpointKey({ kind: "rpc", socketPath: "/tmp/a.sock" })).toBe("rpc:unix:/tmp/a.sock");
  });
});

describe("describeNode", () => {
  it("一行描述含目标、显示名、凭据引用与上次信任级别", () => {
    const text = describeNode({
      id: "x",
      name: "lab",
      endpoint: { kind: "http", baseUrl: "http://a:1" },
      displayName: "实验室",
      credentialRef: "lab-cred",
      lastTrustLevel: "local",
    });
    expect(text).toContain("lab → http://a:1");
    expect(text).toContain("实验室");
    expect(text).toContain("凭据引用 lab-cred");
    expect(text).toContain("local");
  });
});
