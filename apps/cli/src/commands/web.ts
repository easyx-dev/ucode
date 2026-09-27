import { spawn } from "node:child_process";
import { getBrand } from "@ucode/branding";
import type { WebOptions } from "../options.ts";
import { log } from "../runtime.ts";
import { ensureService } from "../service-registry.ts";
import { resolveWebAssets } from "../web-assets.ts";
import { runServiceStart } from "./service.ts";

/**
 * `web` —— 打开 Web 壳。
 *
 * **壳是客户端**：默认只做"确保服务在跑，然后把浏览器指向它"。浏览器与服务同源
 * （服务顺带把 Web 壳的静态资源发出去），因此没有 CORS、没有跨站 cookie 的麻烦。
 *
 * `--foreground` 保留旧行为：前台把服务跑起来（照常注册，其它壳也能连），Ctrl-C 即停。
 */
export async function runWeb(options: WebOptions): Promise<number> {
  if (options.foreground) {
    return runServiceStart({
      dataDir: options.dataDir,
      cwd: options.cwd,
      dataDirSource: options.dataDirSource,
      foreground: true,
      host: options.host,
      port: options.port,
      allowNonLoopback: options.allowNonLoopback,
      noHttp: false,
      autonomy: "confirm",
    });
  }

  // 先确认产物在：服务会把静态资源发出去，但"产物没构建"该在这里就说清楚，
  // 而不是让用户在浏览器里看到一个 404。
  const staticDir = await resolveWebAssets();
  void staticDir;

  const live = await ensureService({
    dataDir: options.dataDir,
    cwd: options.cwd,
    host: options.host,
    port: options.port,
    ...(options.allowNonLoopback ? { allowNonLoopback: true } : {}),
  });
  const url = live.registration.endpoints.http;
  if (url === undefined) {
    log("服务未监听 HTTP（可能以 --no-http 启动），浏览器打不开界面。");
    log(`  unix 通路：${live.registration.endpoints.unix ?? "（无）"}`);
    return 1;
  }

  log(`Web 壳已就绪：${url}`);
  log(`  数据层：${live.registration.dataDir}`);
  const name = getBrand().productName;
  log(`  服务 pid=${live.registration.pid}（常驻；停止用 ${name} service stop）`);
  log(`  再挂一个 TUI：${name} tui --core ${url}`);
  if (options.open) openBrowser(url);
  return 0;
}

/** 让操作系统用默认浏览器打开（三平台各一条命令，不值得为它引依赖）。 */
function openBrowser(url: string): void {
  const command =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  try {
    const child = spawn(command, [url], { detached: true, stdio: "ignore" });
    child.unref();
  } catch (error) {
    log(`打开浏览器失败：${error instanceof Error ? error.message : String(error)}`);
  }
}
