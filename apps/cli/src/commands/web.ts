import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createBinding as createHttpBinding } from "@ucode/binding-http";
import { createCore } from "@ucode/core";
import type { WebOptions } from "../options.ts";
import { log, waitForShutdown } from "../runtime.ts";

/**
 * `web` —— 启动内置 Web 壳。
 *
 * 一个端口同时提供：核心层（进程内）+ HTTP/SSE 绑定 + Web 壳静态资源。
 * 同源的好处是没有 CORS、没有 cookie 的跨站问题；Web 壳因此直接用 `location.origin` 连接。
 *
 * 只监听环回（spec §5.3）；`--allow-non-loopback` 会把信任级别降为 untrusted（只读 + 对话）。
 */
export async function runWeb(options: WebOptions): Promise<number> {
  const staticDir = await resolveWebAssets();
  const core = await createCore({ dataDir: options.dataDir, cwd: options.cwd });
  const binding = createHttpBinding(core, {
    host: options.host,
    port: options.port,
    staticDir,
    ...(options.allowNonLoopback ? { allowNonLoopback: true } : {}),
  });

  await binding.start();
  log(`Web 壳已启动：${binding.endpoint}`);
  log(`  数据层：${core.dataDir}`);
  log(`  静态资源：${staticDir}`);
  log(
    `  信任级别：${binding.trustLevel}${binding.trustLevel === "local" ? "（仅本机可访问）" : "（未认证，只读 + 对话）"}`,
  );

  await waitForShutdown();
  log("正在关闭……");
  await binding.stop();
  await core.close();
  return 0;
}

/**
 * Web 壳的构建产物目录。
 *
 * 从 `@ucode/web` 的包清单定位，而不是按仓库相对路径猜——这样打包后仍然成立。
 */
export async function resolveWebAssets(): Promise<string> {
  let manifestPath: string;
  try {
    manifestPath = fileURLToPath(import.meta.resolve("@ucode/web/package.json"));
  } catch {
    throw new Error("找不到 @ucode/web 包（Web 壳未安装）。");
  }
  const distDir = join(dirname(manifestPath), "dist");
  if (!existsSync(join(distDir, "index.html"))) {
    throw new Error(
      `Web 壳尚未构建（缺少 ${join(distDir, "index.html")}）。请先运行：pnpm -F @ucode/web build`,
    );
  }
  return distDir;
}
