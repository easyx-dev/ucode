// spike/lib.ts —— 探针公共设施
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

// 从 spike/.env 读取供应商配置（该文件已 gitignore），环境变量优先
try {
  process.loadEnvFile(join(import.meta.dirname, ".env"));
} catch {
  // 无 .env 时忽略，依赖已导出的环境变量
}

export const PROVIDER_NAME = "ucastest";
export const PROVIDER = {
  baseUrl: process.env.SPIKE_BASE_URL ?? "http://localhost:8317/v1",
  apiKey: process.env.SPIKE_API_KEY ?? "",
  model: process.env.SPIKE_MODEL ?? "deepseek-v4-flash",
};

if (!PROVIDER.apiKey) {
  throw new Error("缺少 SPIKE_API_KEY。请在 spike/.env 写入 SPIKE_API_KEY=... 或先 export SPIKE_API_KEY=...");
}

/** 把 provider 配置（与可选 settings）写入指定目录，目录不存在则创建 */
export function writeConfig(dir: string, settings?: object): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "models.json"),
    JSON.stringify(
      {
        providers: {
          [PROVIDER_NAME]: {
            baseUrl: PROVIDER.baseUrl,
            api: "openai-completions",
            apiKey: PROVIDER.apiKey,
            models: [
              { id: PROVIDER.model, name: "DeepSeek V4 Flash", input: ["text"], contextWindow: 8000, maxTokens: 512 },
            ],
          },
        },
      },
      null,
      2,
    ),
  );
  if (settings) writeFileSync(join(dir, "settings.json"), JSON.stringify(settings, null, 2));
}

/** 造一个临时 agent 目录，含指向本地供应商的 models.json 与可选 settings.json */
export function makeAgentDir(settings?: object): string {
  const dir = mkdtempSync(join(tmpdir(), "ucode-agent-"));
  writeConfig(dir, settings);
  return dir;
}

/** 快照一个文件的内容/哈希/大小/inode */
export function snapshot(file: string) {
  const buf = readFileSync(file);
  const st = statSync(file);
  return {
    size: buf.length,
    sha256: createHash("sha256").update(buf).digest("hex"),
    inode: st.ino,
    content: buf.toString("utf8"),
  };
}

/** 递归列出目录下所有文件（对不可读目录容错跳过） */
export function listFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    if (!existsSync(d)) return;
    let entries: import("node:fs").Dirent[];
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return; // 无权限/已消失的目录直接跳过
    }
    for (const e of entries) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) out.push(p);
    }
  };
  walk(dir);
  return out;
}

/** 判定 newContent 是否为 oldContent 的前缀延伸 */
export function isPrefixExtension(prev: string, next: string): boolean {
  return next.startsWith(prev);
}

export function nowIso(): string {
  return new Date().toISOString();
}
