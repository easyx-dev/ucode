/**
 * 渲染层来源的固定约定：开发走 Vite dev server，生产走应用内协议。
 *
 * 端口在这里是唯一事实源——`vite.config.ts` 的 `strictPort` 与主进程的开发形态加载共用它，
 * 两边不一致时表现为「窗口开了，但连的是另一个 dev server」。
 */
export const RENDERER_DEV_PORT = 5174;

/** 开发形态的渲染层地址 */
export const RENDERER_DEV_URL = `http://localhost:${RENDERER_DEV_PORT}`;

/**
 * 开发形态开关：`electron . --dev`。
 *
 * 用命令行参数而不是环境变量：行内赋值（`KEY=x cmd`）在 Windows 的 `cmd.exe` 下不成立，
 * 而这条命令由 concurrently 在它自己的 shell 里执行，pnpm 的 `shellEmulator` 管不到它。
 * 显式传参也让「生产形态绝不连 dev server」这条约束看得见。
 */
export const DEV_LAUNCH_FLAG = "--dev";

export const isDevLaunch = (argv: readonly string[]): boolean => argv.includes(DEV_LAUNCH_FLAG);
