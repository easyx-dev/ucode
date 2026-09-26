import { fileURLToPath } from "node:url";
import { getBrand } from "@ucode/branding";
import type { TuiOptions } from "../options.ts";
import { log } from "../runtime.ts";

/**
 * `tui` —— 启动内置 TUI 壳。
 *
 * 两种连法：
 * - 默认：**自己拉起一个核心层**（stdio 绑定）——开箱即用，不要求用户先手动起服务；
 * - `--core <endpoint>`：连一个已经在跑的（unix socket / tcp / http）。
 *
 * 这里只负责"把核心层准备好 + 把 sdk 交给 TUI"；界面在 `@ucode/tui` 里，
 * 它只依赖 sdk（不复用 ui，spec §7.2）。
 */
export async function runTui(options: TuiOptions): Promise<number> {
  const { runTui: startTui } = await import("@ucode/tui");

  const endpoint =
    options.coreEndpoint ??
    ((): { kind: "spawn" } => {
      log(`未指定 --core：将在后台拉起一个核心层（数据层：${options.dataDir}）`);
      return { kind: "spawn" };
    })();

  const cliEntry = fileURLToPath(new URL("../main.ts", import.meta.url));

  return startTui({
    productName: getBrand().productName,
    ...(endpoint.kind === "spawn"
      ? {
          spawnCore: {
            command: process.execPath,
            args: [
              cliEntry,
              "core",
              "start",
              "--binding",
              "stdio",
              "--data-dir",
              options.dataDir,
              "--cwd",
              options.cwd,
            ],
          },
        }
      : { endpoint }),
  });
}
