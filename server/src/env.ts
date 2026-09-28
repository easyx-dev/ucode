import { mkdirSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "../..");

try {
  process.loadEnvFile(resolve(repoRoot, ".env"));
} catch {
  // 没有 .env 时全部使用默认值
}

const resolveDir = (value: string | undefined, fallback: string): string => {
  const raw = value?.trim() || fallback;
  return isAbsolute(raw) ? raw : resolve(repoRoot, raw);
};

const resolveNum = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

const workspaceDir = resolveDir(process.env.PI_WORKSPACE_DIR, ".tmp/.ucode");
const agentDir = resolveDir(process.env.PI_AGENT_DIR, ".tmp/.ucode/agent");
const dataDir = resolveDir(process.env.PI_DATA_DIR, ".tmp/.ucode");

export const env = {
  repoRoot,
  port: resolveNum(process.env.PORT, 2048),
  /** pi agent 的工作目录（工具读写文件、会话分组） */
  workspaceDir,
  /** pi agent 目录：models.json / auth.json 放这里 */
  agentDir,
  /** 应用数据目录：config.json 等 */
  dataDir,
  /** 会话 JSONL 存放目录（保持扁平，便于统一列出） */
  sessionsRoot: resolve(agentDir, "sessions"),
  modelsPath: resolve(agentDir, "models.json"),
  authPath: resolve(agentDir, "auth.json"),
  configPath: resolve(dataDir, "config.json"),
  sessionStatePath: resolve(dataDir, "session-state.json"),
  webDistDir: resolve(repoRoot, "apps/web/dist"),
  poolIdleMs: resolveNum(process.env.POOL_IDLE_MS, 10 * 60 * 1000),
  corsOrigin: process.env.CORS_ORIGIN?.trim() || "*",
};

for (const dir of new Set([
  env.workspaceDir,
  env.agentDir,
  env.dataDir,
  env.sessionsRoot,
])) {
  mkdirSync(dir, { recursive: true });
}
