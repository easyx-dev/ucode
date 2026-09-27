#!/usr/bin/env node
import { envVar, getBrand } from "@ucode/branding";
import cliManifest from "../package.json" with { type: "json" };
import { runCoreStart } from "./commands/core-start.ts";
import { runNodeAdd, runNodeList, runNodeRemove } from "./commands/nodes.ts";
import { runProviderAdd, runProviderList } from "./commands/provider.ts";
import {
  runServiceLogs,
  runServiceStart,
  runServiceStatus,
  runServiceStop,
} from "./commands/service.ts";
import { runTui } from "./commands/tui.ts";
import { runWeb } from "./commands/web.ts";
import { COMMANDS, defaultDataDir, parseCli } from "./options.ts";
import { log } from "./runtime.ts";

const brand = getBrand();

function usage(): string {
  const commands = COMMANDS.map((command) => `  ${command.name.padEnd(12)}${command.summary}`).join(
    "\n",
  );
  const fallback = defaultDataDir();
  return [
    `${brand.productName} —— 分层智能体`,
    "",
    "用法：",
    `  ${brand.productName} <命令> [选项]`,
    "",
    "命令：",
    commands,
    "",
    "常用选项：",
    `  --data-dir <目录>   数据层目录（也可用环境变量 ${envVar("DATA_DIR")}）`,
    "  --cwd <目录>        会话的默认工作目录",
    "  -h, --help          显示本帮助",
    "  -v, --version       显示版本",
    "",
    "服务（唯一后端，壳会自动拉起；一个数据层一个服务）：",
    `  ${brand.productName} service start            拉起常驻服务后返回`,
    `  ${brand.productName} service start --foreground   前台运行（Ctrl-C 即停）`,
    `  ${brand.productName} service status|stop|logs [-f]`,
    "  端点：unix socket（壳用）+ 环回 HTTP（浏览器用，同源服务 Web 壳）",
    "  --no-http                      只留 unix socket，不监听环回端口",
    "",
    "provider add 的选项：",
    "  --base-url <端点>    OpenAI 兼容端点（如 http://127.0.0.1:8317/v1）",
    "  --model <模型名>     模型 id",
    "  --api-key <密钥>     密钥（只写本地 models.json，不入库）",
    "  --id <供应商名>      供应商标识（默认 local）",
    "",
    "web / tui 的选项：",
    "  --open              web：顺带在浏览器里打开",
    "  --foreground        web：前台把服务跑起来（旧行为）",
    "  --core <端点>       tui：连别处的服务（unix socket / host:port / http://…）",
    "",
    "core start 的绑定选项：",
    "  --binding stdio|rpc|http|ws   传输（stdio 供父进程 spawn，rpc 供 unix socket / tcp）",
    "  --socket <路径>               rpc 绑定的 unix socket 路径",
    "  --port <端口>                 rpc / http / ws 的端口（0 = 自动分配）",
    "  --host <地址>                 监听地址（默认只监听环回）",
    "  --allow-non-loopback          显式允许非环回监听（信任级别降为 untrusted：只读 + 对话）",
    "",
    `数据层默认目录：${fallback.dataDir}${fallback.source === "env" ? "（来自环境变量）" : ""}`,
    "",
  ].join("\n");
}

async function main(argv: string[]): Promise<number> {
  const parsed = parseCli(argv);

  switch (parsed.kind) {
    case "help":
      process.stdout.write(usage());
      return 0;
    case "version":
      process.stdout.write(`${cliManifest.version}\n`);
      return 0;
    case "error":
      log(parsed.message);
      log(`运行 ${brand.productName} --help 查看用法。`);
      return parsed.code;
    case "core.start":
      return runCoreStart(parsed.options);
    case "service.start":
      return runServiceStart(parsed.options);
    case "service.status":
      return runServiceStatus(parsed.options);
    case "service.stop":
      return runServiceStop(parsed.options);
    case "service.logs":
      return runServiceLogs(parsed.options);
    case "web":
      return runWeb(parsed.options);
    case "tui":
      return runTui(parsed.options);
    case "provider.add":
      return runProviderAdd(parsed.options);
    case "provider.list":
      return runProviderList(parsed.options);
    case "node.add":
      return runNodeAdd(parsed.options);
    case "node.list":
      return runNodeList(parsed.options);
    case "node.remove":
      return runNodeRemove(parsed.options);
  }
}

process.exitCode = await main(process.argv.slice(2));
