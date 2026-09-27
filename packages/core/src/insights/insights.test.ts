import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { exportSupportBundle, redactLogText } from "./export.ts";
import { applyMigration, preflightMigration, sessionIdFromPath } from "./migration.ts";
import { isSecretKey, looksLikeSecretValue, REDACTED, redact } from "./redact.ts";
import { aggregateUsage, extractUsage, summarizeUsage, type UsageRecord } from "./usage.ts";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "insights-test-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const record = (over: Partial<UsageRecord> = {}): UsageRecord => ({
  input: 100,
  output: 20,
  cacheRead: 0,
  cacheWrite: 0,
  reasoning: 0,
  cost: 0,
  provider: "deepseek",
  modelId: "deepseek-v4-flash",
  day: "2026-03-01",
  ...over,
});

describe("用量抽取与聚合", () => {
  it("从 usage 记录与助手消息两处都能抽到", () => {
    const fromEntry = extractUsage({
      type: "usage",
      provider: "deepseek",
      modelId: "m",
      timestamp: "2026-03-01T10:00:00.000Z",
      usage: { input: 10, output: 2, cost: { total: 0.5 } },
    });
    expect(fromEntry?.input).toBe(10);
    expect(fromEntry?.cost).toBe(0.5);
    expect(fromEntry?.day).toBe("2026-03-01");

    const fromMessage = extractUsage({
      type: "message",
      message: {
        role: "assistant",
        provider: "openai",
        model: "gpt",
        usage: { input: 5, output: 1 },
      },
    });
    expect(fromMessage?.provider).toBe("openai");
    expect(fromMessage?.input).toBe(5);
  });

  it("没有用量信息时返回 null", () => {
    expect(extractUsage({ type: "message", message: { role: "user" } })).toBeNull();
  });

  it("按模型与按天聚合，totals 一致", () => {
    const summary = aggregateUsage([
      record(),
      record({ output: 30 }),
      record({ modelId: "other", input: 7, day: "2026-03-02" }),
    ]);
    expect(summary.records).toBe(3);
    expect(summary.totals.input).toBe(207);
    expect(summary.totals.output).toBe(70);
    expect(summary.byModel.map((bucket) => bucket.key)).toEqual([
      "deepseek/deepseek-v4-flash",
      "deepseek/other",
    ]);
    expect(summary.byDay.map((bucket) => bucket.key)).toEqual(["2026-03-01", "2026-03-02"]);
    expect(summarizeUsage(summary)).toContain("共 3 次调用");
  });

  it("缺失时间戳的记录不计入 byDay，但仍计入 totals", () => {
    const summary = aggregateUsage([record({ day: null })]);
    expect(summary.byDay).toEqual([]);
    expect(summary.totals.input).toBe(100);
  });
});

describe("脱敏", () => {
  it("键名像密钥就抹掉值（含嵌套与数组）", () => {
    const redacted = redact({
      providers: {
        deepseek: {
          apiKey: "sk-real-key-should-vanish",
          baseUrl: "http://x",
          models: [{ id: "m" }],
        },
      },
      list: [{ token: "t" }, { ok: true }],
    });
    const text = JSON.stringify(redacted);
    expect(text).not.toContain("sk-real-key-should-vanish");
    expect(text).toContain(REDACTED);
    expect(text).toContain("http://x"); // 非密钥字段保持原样
    expect(isSecretKey("OPENAI_API_KEY")).toBe(true);
    expect(isSecretKey("baseUrl")).toBe(false);
  });

  it("键名正常但值像密钥也抹掉", () => {
    expect(looksLikeSecretValue("sk-abcdefghijkl")).toBe(true);
    expect(looksLikeSecretValue("ghp_0123456789abcdefghij")).toBe(true);
    expect(looksLikeSecretValue("hello")).toBe(false);
    expect(JSON.stringify(redact({ note: "sk-abcdefghijkl" }))).toContain(REDACTED);
  });

  it("日志文本里的密钥被抹掉（Bearer / key= 两种写法）", () => {
    const masked = redactLogText(
      "Authorization: Bearer abcdefghijklmnop\napiKey=sk-123456789012\nplain line",
    );
    expect(masked).not.toContain("abcdefghijklmnop");
    expect(masked).not.toContain("sk-123456789012");
    expect(masked).toContain("plain line");
  });
});

describe("支持包导出", () => {
  it("产出 .json.gz，含用量/会话索引/配置，且密钥已脱敏", async () => {
    await writeFile(join(root, "version"), "1");
    await writeFile(
      join(root, "models.json"),
      JSON.stringify({ providers: { deepseek: { apiKey: "sk-super-secret-value" } } }),
    );
    await mkdir(join(root, "logs"), { recursive: true });
    await writeFile(join(root, "logs", "core.log"), "用 sk-abcdefghijkl 调用\n");
    await mkdir(join(root, "sessions", "--w--"), { recursive: true });
    await writeFile(join(root, "sessions", "--w--", "20260301_sess-1.jsonl"), "{}\n");

    const bundle = await exportSupportBundle({ dataDir: root });
    expect(bundle.file.endsWith(".json.gz")).toBe(true);
    expect(bundle.included).toContain("usage");

    const parsed = JSON.parse(gunzipSync(await readFile(bundle.file)).toString("utf8")) as {
      config: unknown;
      logs: { name: string; tail: string }[];
      sessions: { count: number };
    };
    const text = JSON.stringify(parsed);
    expect(text).not.toContain("sk-super-secret-value");
    expect(text).not.toContain("sk-abcdefghijkl");
    expect(parsed.sessions.count).toBe(1);
    expect(parsed.logs[0]?.name).toBe("core.log");
  });
});

describe("迁移预检与应用", () => {
  async function makeSource(id: string, bucket = "--w--"): Promise<string> {
    const dir = join(root, `src-${id}`);
    await mkdir(join(dir, "sessions", bucket), { recursive: true });
    await writeFile(join(dir, "version"), "1");
    await writeFile(join(dir, "sessions", bucket, `20260301_${id}.jsonl`), `{"id":"${id}"}\n`);
    return dir;
  }

  it("会话 id 从文件名里取", () => {
    expect(sessionIdFromPath("/x/20260301T0000_abc-123.jsonl")).toBe("abc-123");
  });

  it("预检只读：报告版本、总量与冲突", async () => {
    const from = await makeSource("a");
    // 目标里放一条同 id 的会话 → 冲突（源与目标不能是同一个目录，否则被阻塞）。
    const to = join(root, "target-a");
    await mkdir(join(to, "sessions", "--w--"), { recursive: true });
    await writeFile(join(to, "version"), "1");
    await writeFile(join(to, "sessions", "--w--", "20260301_a.jsonl"), "本机已有\n");
    const report = await preflightMigration({ from, to });
    expect(report.canMigrate).toBe(true);
    expect(report.sessions.total).toBe(1);
    expect(report.sessions.conflicts).toHaveLength(1);
    expect(report.warnings.join("")).toContain("默认跳过");
  });

  it("源目录不是数据层时给出阻塞原因", async () => {
    const empty = join(root, "not-a-store");
    await mkdir(empty, { recursive: true });
    const report = await preflightMigration({ from: empty, to: join(root, "target") });
    expect(report.canMigrate).toBe(false);
    expect(report.blockers.join("")).toContain("version");
  });

  it("源与目标相同被拒", async () => {
    const from = await makeSource("b");
    const report = await preflightMigration({ from, to: from });
    expect(report.canMigrate).toBe(false);
  });

  it("默认跳过冲突；overwrite 才覆盖", async () => {
    const from = await makeSource("c");
    const to = join(root, "target-c");
    await mkdir(join(to, "sessions", "--w--"), { recursive: true });
    await writeFile(join(to, "version"), "1");
    await writeFile(join(to, "sessions", "--w--", "20260301_c.jsonl"), "本机版本\n");

    const skipped = await applyMigration({ from, to });
    expect(skipped.copied).toHaveLength(0);
    expect(skipped.skipped).toHaveLength(1);
    expect(await readFile(join(to, "sessions", "--w--", "20260301_c.jsonl"), "utf8")).toBe(
      "本机版本\n",
    );

    const overwritten = await applyMigration({ from, to, onConflict: "overwrite" });
    expect(overwritten.copied).toHaveLength(1);
    expect(await readFile(join(to, "sessions", "--w--", "20260301_c.jsonl"), "utf8")).toContain(
      '"c"',
    );
  });
});
