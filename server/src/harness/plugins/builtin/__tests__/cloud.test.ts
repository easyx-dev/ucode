/**
 * 内置资产的云端下发：清单比对、sha256 校验、生效边界与中继域约束。
 *
 * 全是纯函数（清单解析 / 计划 / 校验 / 激活判定 / 下载地址解析）加上磁盘上的物化交互，
 * **不连网络**：拉取过程里联网的那段（fetch）不在单测范围内，用中继侧接口自己的契约测试兜。
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { resolveBuiltinAssets } from "..";
import {
  type CloudBuiltinAsset,
  type DownloadedBuiltinFile,
  decideBuiltinActivation,
  isSafeRelativePath,
  parseBuiltinBundle,
  parseCloudManifest,
  planBuiltinSync,
  pullCloudBuiltinAssets,
  resolveBuiltinDownloadUrl,
  verifyBuiltinAssetFiles,
} from "../cloud";
import {
  type BuiltinAssetRecord,
  hashBuiltinAssetFiles,
  readBuiltinManifest,
  writeBuiltinManifest,
} from "../manifest";
import { materializeBuiltinAssets } from "../materialize";

const created: string[] = [];

const makeDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "builtin-cloud-"));
  created.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const sha256 = (content: string): string => createHash("sha256").update(content).digest("hex");

/** 一项云端资产：默认是纯文本技能，可逐字段覆盖 */
const remoteAsset = (over: Partial<CloudBuiltinAsset> = {}): CloudBuiltinAsset => {
  const content = over.files?.[0] ? "" : "正文";
  return {
    id: over.id ?? "demo-skill",
    kind: over.kind ?? "skill",
    version: over.version ?? "1.0.0",
    executable: over.executable ?? false,
    path: over.path ?? "/builtin/assets/demo-skill/1.0.0",
    size: over.size ?? 0,
    files: over.files ?? [{ path: "SKILL.md", sha256: sha256(content), size: 6 }],
  };
};

const localRecord = (over: Partial<BuiltinAssetRecord> = {}): BuiltinAssetRecord => ({
  id: over.id ?? "demo-skill",
  kind: over.kind ?? "skill",
  version: over.version ?? "1.0.0",
  sha256: over.sha256 ?? "a".repeat(64),
  origin: over.origin ?? "packaged",
  executable: over.executable ?? false,
  active: over.active ?? true,
  updatedAt: over.updatedAt ?? "2026-01-01T00:00:00.000Z",
});

const downloaded = (path: string, content: string): DownloadedBuiltinFile => ({
  path,
  bytes: Buffer.from(content, "utf8"),
  sha256: sha256(content),
});

describe("planBuiltinSync", () => {
  it("按 id + 版本比对：同版本跳过，缺失或版本不同才下载", () => {
    const plan = planBuiltinSync(
      [localRecord({ id: "same", version: "1.0.0" }), localRecord({ id: "old", version: "1.0.0" })],
      [
        remoteAsset({ id: "same", version: "1.0.0" }),
        remoteAsset({ id: "old", version: "2.0.0" }),
        remoteAsset({ id: "fresh", version: "1.0.0" }),
      ],
    );

    assert.deepEqual(
      plan.downloads.map((asset) => asset.id),
      ["old", "fresh"],
    );
    assert.deepEqual(plan.skipped, ["same"]);
  });

  it("类型变了即使 id 与版本相同也要下载（同名技能与提示词是两回事）", () => {
    const plan = planBuiltinSync(
      [localRecord({ id: "review", kind: "prompt", version: "1.0.0" })],
      [remoteAsset({ id: "review", kind: "skill", version: "1.0.0" })],
    );

    assert.deepEqual(
      plan.downloads.map((asset) => asset.kind),
      ["skill"],
    );
    assert.deepEqual(plan.skipped, []);
  });
});

describe("verifyBuiltinAssetFiles", () => {
  it("全部对上时没有问题", () => {
    const expected = remoteAsset({
      files: [
        { path: "SKILL.md", sha256: sha256("正文"), size: 6 },
        { path: "references/api.md", sha256: sha256("参考"), size: 6 },
      ],
    }).files;

    assert.deepEqual(
      verifyBuiltinAssetFiles(expected, [
        downloaded("SKILL.md", "正文"),
        downloaded("references/api.md", "参考"),
      ]),
      [],
    );
  });

  it("sha256 不符、体积不符、缺文件与多文件都逐条报出", () => {
    const expected = remoteAsset({
      files: [{ path: "SKILL.md", sha256: sha256("正文"), size: 6 }],
    }).files;

    const tampered = verifyBuiltinAssetFiles(expected, [downloaded("SKILL.md", "改过的正文")]);
    assert.equal(tampered.length, 2, "体积与 sha256 各报一条");
    assert.match(tampered.join("\n"), /体积不符/);
    assert.match(tampered.join("\n"), /sha256 不符/);

    assert.match(
      verifyBuiltinAssetFiles(expected, []).join("\n"),
      /缺少文件 SKILL\.md/,
      "缺文件即失败",
    );
    assert.match(
      verifyBuiltinAssetFiles(expected, [
        downloaded("SKILL.md", "正文"),
        downloaded("extra.sh", "#!/bin/sh"),
      ]).join("\n"),
      /多出清单没登记的 extra\.sh/,
    );
  });
});

describe("decideBuiltinActivation", () => {
  it("技能与提示词可直接生效", () => {
    assert.deepEqual(decideBuiltinActivation(remoteAsset()), { active: true });
    assert.deepEqual(decideBuiltinActivation(remoteAsset({ kind: "prompt" })), { active: true });
  });

  it("含可执行内容的资产一律拒绝生效（来源是运营方也不放宽）", () => {
    const decision = decideBuiltinActivation(remoteAsset({ executable: true }));
    assert.equal(decision.active, false);
    assert.match(decision.active ? "" : decision.reason, /含可执行内容/);
  });

  it("v1 只生效技能与提示词，其它类型只落盘", () => {
    const decision = decideBuiltinActivation(remoteAsset({ kind: "plugin" }));
    assert.equal(decision.active, false);
    assert.match(decision.active ? "" : decision.reason, /不在可生效范围内/);
  });
});

describe("resolveBuiltinDownloadUrl", () => {
  it("同域的资产路径按中继地址解析", () => {
    assert.equal(
      resolveBuiltinDownloadUrl("https://relay.example.com", "/builtin/assets/demo/1.0.0"),
      "https://relay.example.com/builtin/assets/demo/1.0.0",
    );
  });

  it("中继地址带路径前缀时前缀保留（挂在反代子路径下的部署）", () => {
    assert.equal(
      resolveBuiltinDownloadUrl("https://relay.example.com/relay/", "/builtin/assets/demo/1.0.0"),
      "https://relay.example.com/relay/builtin/assets/demo/1.0.0",
    );
  });

  it("换域的绝对地址、协议相对地址与非资产路径一律拒绝", () => {
    assert.equal(
      resolveBuiltinDownloadUrl(
        "https://relay.example.com",
        "https://evil.test/builtin/assets/a/1",
      ),
      null,
    );
    assert.equal(
      resolveBuiltinDownloadUrl("https://relay.example.com", "//evil.test/builtin/assets/a/1"),
      null,
    );
    assert.equal(resolveBuiltinDownloadUrl("https://relay.example.com", "/api/v1/health"), null);
    assert.equal(resolveBuiltinDownloadUrl("not a url", "/builtin/assets/a/1"), null);
    assert.equal(resolveBuiltinDownloadUrl("file:///etc", "/builtin/assets/a/1"), null);
  });
});

describe("parseCloudManifest", () => {
  it("结构不认识的条目丢掉并出诊断，其余照常可用", () => {
    const { manifest, problems } = parseCloudManifest({
      version: 1,
      updatedAt: "2026-01-01T00:00:00.000Z",
      assets: [
        {
          id: "ok",
          kind: "skill",
          version: "1.0.0",
          executable: false,
          path: "/builtin/assets/ok/1.0.0",
          files: [{ path: "SKILL.md", sha256: sha256("正文"), size: 6 }],
        },
        {
          id: "../escape",
          kind: "skill",
          version: "1.0.0",
          executable: false,
          path: "/builtin/assets/x/1",
          files: [],
        },
        {
          id: "no-files",
          kind: "skill",
          version: "1.0.0",
          executable: false,
          path: "/builtin/assets/x/1",
          files: [],
        },
        {
          id: "bad-path",
          kind: "skill",
          version: "1.0.0",
          executable: false,
          path: "https://evil.test/x",
          files: [{ path: "SKILL.md", sha256: sha256("正文"), size: 6 }],
        },
        {
          id: "bad-sha",
          kind: "skill",
          version: "1.0.0",
          executable: false,
          path: "/builtin/assets/x/1",
          files: [{ path: "SKILL.md", sha256: "短", size: 6 }],
        },
      ],
    });

    assert.deepEqual(
      manifest.assets.map((asset) => asset.id),
      ["ok"],
    );
    assert.equal(problems.length, 4);
    assert.match(problems.join("\n"), /下载路径不在/);
  });

  it("缺少可执行标记时按含可执行内容处理（不默认信任）", () => {
    const { manifest } = parseCloudManifest({
      assets: [
        {
          id: "demo",
          kind: "skill",
          version: "1.0.0",
          path: "/builtin/assets/demo/1.0.0",
          files: [{ path: "SKILL.md", sha256: sha256("正文"), size: 6 }],
        },
      ],
    });

    assert.equal(manifest.assets[0]?.executable, true);
  });

  it("结构认不出来时给空清单与一条诊断", () => {
    const { manifest, problems } = parseCloudManifest({ hello: "world" });
    assert.deepEqual(manifest.assets, []);
    assert.match(problems.join("\n"), /缺少 assets/);
  });
});

describe("parseBuiltinBundle", () => {
  it("utf8 与 base64 都按本侧算出的字节还原", () => {
    const binary = Buffer.from([0x00, 0xff, 0x10]);
    const parsed = parseBuiltinBundle({
      id: "demo",
      version: "1.0.0",
      files: [
        { path: "SKILL.md", sha256: sha256("正文"), size: 6, encoding: "utf8", content: "正文" },
        {
          path: "assets/logo.bin",
          sha256: createHash("sha256").update(binary).digest("hex"),
          size: 3,
          encoding: "base64",
          content: binary.toString("base64"),
        },
      ],
    });

    assert.deepEqual(parsed.problems, []);
    assert.equal(parsed.files[0]?.bytes.toString("utf8"), "正文");
    assert.deepEqual([...(parsed.files[1]?.bytes ?? [])], [...binary]);
  });

  it("自报 sha256 不符、编码不认识、路径越界都记诊断", () => {
    const parsed = parseBuiltinBundle({
      files: [
        { path: "SKILL.md", sha256: "b".repeat(64), size: 6, encoding: "utf8", content: "正文" },
        { path: "a.md", sha256: sha256("x"), size: 1, encoding: "hex", content: "78" },
        { path: "../escape.md", sha256: sha256("x"), size: 1, encoding: "utf8", content: "x" },
      ],
    });

    assert.equal(parsed.files.length, 1);
    assert.match(parsed.problems.join("\n"), /与其自报值不符/);
    assert.match(parsed.problems.join("\n"), /编码方式不在支持范围内/);
    assert.match(parsed.problems.join("\n"), /路径或正文不合法/);
  });
});

describe("isSafeRelativePath", () => {
  it("拒绝绝对路径、反斜杠与 . / .. 段", () => {
    assert.equal(isSafeRelativePath("SKILL.md"), true);
    assert.equal(isSafeRelativePath("references/api.md"), true);
    assert.equal(isSafeRelativePath("/etc/passwd"), false);
    assert.equal(isSafeRelativePath("../x"), false);
    assert.equal(isSafeRelativePath("a/../../x"), false);
    assert.equal(isSafeRelativePath("a//b"), false);
    assert.equal(isSafeRelativePath("a\\b"), false);
    assert.equal(isSafeRelativePath(""), false);
  });
});

describe("云端接管随包资产", () => {
  it("已生效的云端记录让随包版本让位：内容不被写回，记录也不被冲掉", () => {
    const builtinDir = makeDir();
    const first = materializeBuiltinAssets({ builtinDir, now: "2026-01-01T00:00:00.000Z" });
    assert.ok(first.written > 0);

    // 模拟一次云同步的结果：把 plugin-create 换成云端版本并登记
    const cloudContent = "---\nname: plugin-create\n---\n云端正文\n";
    const cloudDir = join(builtinDir, "skills", "plugin-create");
    mkdirSync(cloudDir, { recursive: true });
    writeFileSync(join(cloudDir, "SKILL.md"), cloudContent, "utf8");
    const cloudRecord: BuiltinAssetRecord = {
      id: "plugin-create",
      kind: "skill",
      version: "0.2.0",
      sha256: sha256(cloudContent),
      origin: "cloud",
      executable: false,
      active: true,
      fetchedAt: "2026-02-02T00:00:00.000Z",
      updatedAt: "2026-02-02T00:00:00.000Z",
    };
    writeBuiltinManifest(builtinDir, {
      version: 1,
      assets: [...readBuiltinManifest(builtinDir).assets, cloudRecord],
    });

    assert.equal(
      resolveBuiltinAssets({ builtinDir }).some((asset) => asset.id === "plugin-create"),
      false,
      "随包版本已让位",
    );
    assert.equal(
      resolveBuiltinAssets().some((asset) => asset.id === "plugin-create"),
      true,
      "不给目录时仍是纯随包集合",
    );

    // 再跑一次随包物化：云端内容与云端记录都该原样留着
    const second = materializeBuiltinAssets({ builtinDir, now: "2026-03-03T00:00:00.000Z" });
    assert.equal(readFileSync(join(cloudDir, "SKILL.md"), "utf8"), cloudContent);
    assert.deepEqual(second.diagnostics, []);
    assert.deepEqual(
      readBuiltinManifest(builtinDir).assets.find((record) => record.id === "plugin-create"),
      cloudRecord,
    );
    assert.equal(existsSync(join(builtinDir, "skills", "plugin-create", "SKILL.md")), true);
  });

  it("未生效的云端记录不让位（随包那份仍是当前生效版本）", () => {
    const builtinDir = makeDir();
    writeBuiltinManifest(builtinDir, {
      version: 1,
      assets: [
        {
          id: "plugin-create",
          kind: "skill",
          version: "0.2.0",
          sha256: "c".repeat(64),
          origin: "cloud",
          executable: true,
          active: false,
          fetchedAt: "2026-02-02T00:00:00.000Z",
          updatedAt: "2026-02-02T00:00:00.000Z",
        },
      ],
    });

    assert.equal(
      resolveBuiltinAssets({ builtinDir }).some((asset) => asset.id === "plugin-create"),
      true,
    );
  });
});

describe("pullCloudBuiltinAssets", () => {
  const HUB = "https://relay.example.com";

  /** 内容包响应体：按 encoding 还原内容，逐文件带哈希与体积 */
  const bundleOf = (asset: CloudBuiltinAsset, contents: Record<string, string>) => ({
    id: asset.id,
    kind: asset.kind,
    version: asset.version,
    executable: asset.executable,
    files: asset.files.map((file) => ({
      ...file,
      encoding: "utf8" as const,
      content: contents[file.path] ?? "",
    })),
  });

  /** 假中继：清单 + 内容包都由调用方给，不发任何请求 */
  const requestOf = (manifest: unknown, bundles: Record<string, unknown>) => {
    const urls: string[] = [];
    return {
      urls,
      request: async (url: URL): Promise<unknown> => {
        urls.push(url.pathname);
        if (url.pathname === "/builtin/manifest") return manifest;
        const bundle = bundles[url.pathname];
        if (bundle === undefined) throw new Error("中继回了 404");
        return bundle;
      },
    };
  };

  it("缺失的资产下载并物化，状态记 origin=cloud 与 fetchedAt", async () => {
    const builtinDir = makeDir();
    const content = "---\nname: demo-skill\n---\n云端正文\n";
    const asset = remoteAsset({
      files: [{ path: "SKILL.md", sha256: sha256(content), size: Buffer.byteLength(content) }],
    });
    const hub = requestOf(
      { version: 1, assets: [asset] },
      {
        [asset.path]: bundleOf(asset, { "SKILL.md": content }),
      },
    );

    const result = await pullCloudBuiltinAssets({
      hubUrl: HUB,
      deviceToken: "device-token",
      builtinDir,
      now: "2026-02-02T00:00:00.000Z",
      fetchJson: hub.request,
    });

    assert.equal(result.fetched, true);
    assert.deepEqual(result.applied, ["demo-skill"]);
    assert.deepEqual(result.diagnostics, []);
    assert.equal(
      readFileSync(join(builtinDir, "skills", "demo-skill", "SKILL.md"), "utf8"),
      content,
    );
    assert.deepEqual(readBuiltinManifest(builtinDir).assets, [
      {
        id: "demo-skill",
        kind: "skill",
        version: "1.0.0",
        sha256: hashBuiltinAssetFiles([{ path: "SKILL.md", bytes: Buffer.from(content) }]),
        origin: "cloud",
        executable: false,
        active: true,
        fetchedAt: "2026-02-02T00:00:00.000Z",
        updatedAt: "2026-02-02T00:00:00.000Z",
      },
    ]);
    assert.deepEqual(hub.urls, ["/builtin/manifest", asset.path], "清单与内容各拉一次");
  });

  it("含可执行内容的资产只落盘到 quarantine，不生效并记诊断", async () => {
    const builtinDir = makeDir();
    const content = "{}";
    const asset = remoteAsset({
      id: "demo-hooks",
      executable: true,
      path: "/builtin/assets/demo-hooks/1.0.0",
      files: [{ path: "hooks/hooks.json", sha256: sha256(content), size: 2 }],
    });
    const hub = requestOf(
      { version: 1, assets: [asset] },
      {
        [asset.path]: bundleOf(asset, { "hooks/hooks.json": content }),
      },
    );

    const result = await pullCloudBuiltinAssets({
      hubUrl: HUB,
      deviceToken: "device-token",
      builtinDir,
      fetchJson: hub.request,
    });

    assert.deepEqual(result.quarantined, ["demo-hooks"]);
    assert.deepEqual(result.applied, []);
    assert.match(result.diagnostics.join("\n"), /已下载但未生效（含可执行内容/);
    assert.equal(
      existsSync(join(builtinDir, "skills", "demo-hooks")),
      false,
      "不进装配扫描的技能目录",
    );
    assert.equal(
      readFileSync(
        join(builtinDir, "quarantine", "demo-hooks", "1.0.0", "hooks", "hooks.json"),
        "utf8",
      ),
      content,
    );
    const record = readBuiltinManifest(builtinDir).assets[0];
    assert.equal(record?.active, false);
    assert.equal(record?.executable, true);
  });

  it("sha256 不符时整条丢弃：不落盘也不登记", async () => {
    const builtinDir = makeDir();
    const asset = remoteAsset({
      files: [{ path: "SKILL.md", sha256: sha256("正文"), size: 6 }],
    });
    const hub = requestOf(
      { version: 1, assets: [asset] },
      {
        [asset.path]: bundleOf(asset, { "SKILL.md": "改过的正文" }),
      },
    );

    const result = await pullCloudBuiltinAssets({
      hubUrl: HUB,
      deviceToken: "device-token",
      builtinDir,
      fetchJson: hub.request,
    });

    assert.match(result.diagnostics.join("\n"), /sha256 不符/);
    assert.match(result.diagnostics.join("\n"), /整条丢弃/);
    assert.equal(existsSync(join(builtinDir, "skills", "demo-skill")), false);
    assert.deepEqual(readBuiltinManifest(builtinDir).assets, []);
  });

  it("提示词物化成 builtin/prompts/<id>.md（装配扫描的目录）", async () => {
    const builtinDir = makeDir();
    const content = "---\ndescription: 审查改动\n---\n\n正文\n";
    const asset = remoteAsset({
      id: "review",
      kind: "prompt",
      path: "/builtin/assets/review/1.0.0",
      files: [{ path: "review.md", sha256: sha256(content), size: Buffer.byteLength(content) }],
    });
    const hub = requestOf(
      { version: 1, assets: [asset] },
      {
        [asset.path]: bundleOf(asset, { "review.md": content }),
      },
    );

    const result = await pullCloudBuiltinAssets({
      hubUrl: HUB,
      deviceToken: "device-token",
      builtinDir,
      fetchJson: hub.request,
    });

    assert.deepEqual(result.applied, ["review"]);
    assert.equal(readFileSync(join(builtinDir, "prompts", "review.md"), "utf8"), content);
  });

  it("本地已是最新（id + 版本一致）时不重复下载", async () => {
    const builtinDir = makeDir();
    const asset = remoteAsset();
    const hub = requestOf({ version: 1, assets: [asset] }, {});

    writeBuiltinManifest(builtinDir, {
      version: 1,
      assets: [
        {
          id: asset.id,
          kind: asset.kind,
          version: asset.version,
          sha256: "d".repeat(64),
          origin: "cloud",
          executable: false,
          active: true,
          fetchedAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    });

    const result = await pullCloudBuiltinAssets({
      hubUrl: HUB,
      deviceToken: "device-token",
      builtinDir,
      fetchJson: hub.request,
    });

    assert.deepEqual(result.skipped, ["demo-skill"]);
    assert.deepEqual(hub.urls, ["/builtin/manifest"], "只拉了清单");
  });

  it("未接入中继（无地址或无设备令牌）时什么都不做，也不报诊断", async () => {
    const builtinDir = makeDir();
    const hub = requestOf({ version: 1, assets: [] }, {});

    const noUrl = await pullCloudBuiltinAssets({
      hubUrl: null,
      deviceToken: "device-token",
      builtinDir,
      fetchJson: hub.request,
    });
    const noToken = await pullCloudBuiltinAssets({
      hubUrl: HUB,
      deviceToken: null,
      builtinDir,
      fetchJson: hub.request,
    });

    assert.equal(noUrl.fetched, false);
    assert.equal(noToken.fetched, false);
    assert.deepEqual([...noUrl.diagnostics, ...noToken.diagnostics], []);
    assert.deepEqual(hub.urls, []);
  });

  it("中继不可达只记诊断，不抛也不落盘", async () => {
    const builtinDir = makeDir();
    const result = await pullCloudBuiltinAssets({
      hubUrl: HUB,
      deviceToken: "device-token",
      builtinDir,
      fetchJson: async () => {
        throw new Error("fetch failed");
      },
    });

    assert.equal(result.fetched, true);
    assert.match(result.diagnostics.join("\n"), /云同步失败（fetch failed）/);
    assert.deepEqual(readBuiltinManifest(builtinDir).assets, []);
  });
  it("写盘失败时只记这一条的诊断，其余资产照常落地", async () => {
    const builtinDir = makeDir();
    const skillContent = "---\nname: broken-skill\n---\n正文\n";
    const promptContent = "---\ndescription: 审查改动\n---\n\n正文\n";
    // 用一个同名文件挡住技能父目录，制造写盘失败；提示词写的是另一个目录，不受影响
    writeFileSync(join(builtinDir, "skills"), "挡住了", "utf8");

    const broken = remoteAsset({
      id: "broken-skill",
      path: "/builtin/assets/broken-skill/1.0.0",
      files: [
        { path: "SKILL.md", sha256: sha256(skillContent), size: Buffer.byteLength(skillContent) },
      ],
    });
    const ok = remoteAsset({
      id: "review",
      kind: "prompt",
      path: "/builtin/assets/review/1.0.0",
      files: [
        {
          path: "review.md",
          sha256: sha256(promptContent),
          size: Buffer.byteLength(promptContent),
        },
      ],
    });
    const hub = requestOf(
      { version: 1, assets: [broken, ok] },
      {
        [broken.path]: bundleOf(broken, { "SKILL.md": skillContent }),
        [ok.path]: bundleOf(ok, { "review.md": promptContent }),
      },
    );

    const result = await pullCloudBuiltinAssets({
      hubUrl: HUB,
      deviceToken: "device-token",
      builtinDir,
      fetchJson: hub.request,
    });

    assert.match(result.diagnostics.join("\n"), /落盘失败/);
    assert.deepEqual(result.applied, ["review"]);
    assert.deepEqual(
      readBuiltinManifest(builtinDir).assets.map((record) => record.id),
      ["review"],
      "失败的那条不登记",
    );
  });
});
