/**
 * 浏览器探测：按源方案 §7 的 6 级优先级找出一个可用的可执行文件，找不到时说明试过什么。
 *
 * 缓存目录只做「按名字浅层找可执行文件」，不写死各平台的相对路径表——Playwright / Puppeteer
 * 的缓存布局随版本变，猜路径必然过期。
 *
 * 环境变量用的是第三方工具惯例名（`CHROME_PATH` / `EDGE_PATH`），不套 `APP_` 前缀：
 * 它们不是本服务的配置项，服务启动不依赖它们，只是给外部工具链留一个显式覆盖口。
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

import { BROWSER_DETECT_TRIED_MAX } from "../../../constants/browser";

export type BrowserName =
  | "chrome"
  | "chrome-beta"
  | "chrome-dev"
  | "chrome-canary"
  | "edge"
  | "chromium"
  | "brave";

/** 命中的来源，排障时能说明「这个浏览器是哪来的」 */
export type BrowserOrigin =
  | "override"
  | "env"
  | "standard"
  | "path"
  | "playwright-cache"
  | "puppeteer-cache";

export type DetectedBrowser = {
  path: string;
  name: BrowserName;
  origin: BrowserOrigin;
};

/** 探测依赖的环境与文件系统：测试可注入，生产走真实实现 */
export type BrowserProbe = {
  platform: NodeJS.Platform;
  env: Record<string, string | undefined>;
  home: string;
  exists: (path: string) => boolean;
  isDir: (path: string) => boolean;
  list: (dir: string) => string[];
};

export type DetectInput = {
  /** 显式指定的可执行文件（`browser_open` 的 `executablePath`），最高优先级 */
  override?: string;
  probe?: Partial<BrowserProbe>;
};

export type DetectResult = {
  browser: DetectedBrowser | null;
  /** 依次试过的路径与命令，失败文案里要列出来 */
  tried: string[];
};

type Candidate = { name: BrowserName; path: string };

const defaultProbe = (): BrowserProbe => ({
  platform: process.platform,
  env: process.env,
  home: homedir(),
  exists: existsSync,
  isDir: (path) => {
    try {
      return statSync(path).isDirectory();
    } catch {
      return false;
    }
  },
  list: (dir) => {
    try {
      return readdirSync(dir);
    } catch {
      return [];
    }
  },
});

const macApplications = "/Applications";

/** 各平台的标准安装路径：Chrome 四个通道 + Edge / Chromium / Brave */
const standardCandidates = (probe: BrowserProbe): Candidate[] => {
  if (probe.platform === "darwin") {
    const app = (bundle: string, binary: string): Candidate["path"] =>
      `${macApplications}/${bundle}.app/Contents/MacOS/${binary}`;
    return [
      { name: "chrome", path: app("Google Chrome", "Google Chrome") },
      { name: "chrome-beta", path: app("Google Chrome Beta", "Google Chrome Beta") },
      { name: "chrome-dev", path: app("Google Chrome Dev", "Google Chrome Dev") },
      { name: "chrome-canary", path: app("Google Chrome Canary", "Google Chrome Canary") },
      { name: "edge", path: app("Microsoft Edge", "Microsoft Edge") },
      { name: "chromium", path: app("Chromium", "Chromium") },
      { name: "brave", path: app("Brave Browser", "Brave Browser") },
    ];
  }

  if (probe.platform === "win32") {
    // Windows 的安装位置最杂：Program Files / Program Files (x86) / 用户级 LOCALAPPDATA；
    // Edge 在 64 位机器上也常落在 (x86) 那一档
    const roots = [
      probe.env.ProgramFiles,
      probe.env["ProgramFiles(x86)"],
      probe.env.LOCALAPPDATA,
    ].filter((root): root is string => Boolean(root));
    const candidates: Candidate[] = [];
    for (const root of roots) {
      candidates.push(
        { name: "chrome", path: join(root, "Google", "Chrome", "Application", "chrome.exe") },
        { name: "edge", path: join(root, "Microsoft", "Edge", "Application", "msedge.exe") },
        { name: "chromium", path: join(root, "Chromium", "Application", "chrome.exe") },
        {
          name: "brave",
          path: join(root, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
        },
      );
    }
    return candidates;
  }

  // Linux 常见的是包管理器与 snap / flatpak：其余位置交给 PATH 查找
  return [
    { name: "chromium", path: "/snap/bin/chromium" },
    { name: "chrome", path: "/var/lib/flatpak/exports/bin/com.google.Chrome" },
    {
      name: "chromium",
      path: join(probe.home, ".local/share/flatpak/exports/bin/org.chromium.Chromium"),
    },
  ];
};

/** PATH 查找：不 spawn 进程，按分隔符逐个拼出候选路径 */
const pathCandidates = (probe: BrowserProbe): Candidate[] => {
  const commands: { name: BrowserName; command: string }[] =
    probe.platform === "win32"
      ? [
          { name: "chrome", command: "chrome.exe" },
          { name: "edge", command: "msedge.exe" },
          { name: "brave", command: "brave.exe" },
        ]
      : [
          { name: "chrome", command: "google-chrome" },
          { name: "chrome", command: "google-chrome-stable" },
          { name: "chromium", command: "chromium" },
          { name: "chromium", command: "chromium-browser" },
          { name: "edge", command: "microsoft-edge" },
          { name: "brave", command: "brave-browser" },
        ];

  const dirs = (probe.env.PATH ?? "").split(delimiter).filter(Boolean);
  return commands.flatMap(({ name, command }) =>
    dirs.map((dir) => ({ name, path: join(dir, command) })),
  );
};

/** 缓存目录里的可执行文件名：按平台惯例取全，找不到就返回 null */
const cacheBinaryNames = (platform: NodeJS.Platform): string[] => {
  if (platform === "darwin")
    return ["Chromium", "Google Chrome for Testing", "chrome", "headless_shell"];
  if (platform === "win32")
    return ["chrome.exe", "chrome-headless-shell.exe", "headless_shell.exe"];
  return ["chrome", "chrome-headless-shell", "headless_shell"];
};

const CACHE_SCAN_MAX_DIRS = 200;

/** 在缓存目录里按名字浅层找可执行文件；headless shell 目录排在完整 Chromium 之后 */
const findExecutable = (
  root: string,
  probe: BrowserProbe,
  budget: { left: number },
): string | null => {
  if (budget.left <= 0 || !probe.isDir(root)) return null;
  budget.left -= 1;
  const entries = probe.list(root);
  for (const name of cacheBinaryNames(probe.platform)) {
    if (entries.includes(name) && probe.exists(join(root, name))) return join(root, name);
  }
  for (const entry of entries) {
    if (entry.startsWith(".")) continue;
    const found = findExecutable(join(root, entry), probe, budget);
    if (found) return found;
  }
  return null;
};

/** 缓存根目录：Playwright 与 Puppeteer 各一套，两个来源分开报，排障时能看出是哪一档命中的 */
const cacheRoots = (probe: BrowserProbe, kind: "playwright" | "puppeteer"): string[] => {
  const cacheHome =
    probe.platform === "darwin"
      ? join(probe.home, "Library", "Caches")
      : join(probe.home, ".cache");
  if (kind === "puppeteer") {
    const windowsRoot = probe.env.LOCALAPPDATA ? join(probe.env.LOCALAPPDATA, "puppeteer") : null;
    return probe.platform === "win32" && windowsRoot
      ? [windowsRoot]
      : [join(probe.home, ".cache", "puppeteer")];
  }
  return probe.platform === "win32" && probe.env.LOCALAPPDATA
    ? [join(probe.env.LOCALAPPDATA, "ms-playwright")]
    : [join(cacheHome, "ms-playwright"), join(probe.home, ".cache", "ms-playwright")];
};

const cacheCandidates = (probe: BrowserProbe, kind: "playwright" | "puppeteer"): Candidate[] => {
  const found: Candidate[] = [];
  for (const root of cacheRoots(probe, kind)) {
    const budget = { left: CACHE_SCAN_MAX_DIRS };
    for (const entry of probe.list(root)) {
      // `chromium-1234` 是完整版，`chromium_headless_shell-1234` 只有截图的壳子，排它后面
      if (
        !entry.startsWith("chromium-") &&
        !entry.startsWith("chromium_headless_shell-") &&
        kind === "playwright"
      ) {
        continue;
      }
      const path = findExecutable(join(root, entry), probe, budget);
      if (path) found.push({ name: "chromium", path });
    }
  }
  return found;
};

/** 环境变量覆盖：`CHROME_PATH` / `EDGE_PATH` 是自动化生态的惯例名 */
const envCandidates = (probe: BrowserProbe): Candidate[] =>
  [
    { name: "chrome" as const, value: probe.env.CHROME_PATH },
    { name: "edge" as const, value: probe.env.EDGE_PATH },
    { name: "chromium" as const, value: probe.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH },
  ].flatMap(({ name, value }) => (value ? [{ name, path: value }] : []));

/**
 * 依次尝试六级来源，命中即返回。
 * 各级之间是「源头不同」而不是「兜底不同」：显式覆盖 > 环境变量 > 标准路径 > PATH > Playwright 缓存 > Puppeteer 缓存。
 */
export const detectBrowser = (input: DetectInput = {}): DetectResult => {
  const probe: BrowserProbe = { ...defaultProbe(), ...input.probe };
  const levels: { origin: BrowserOrigin; candidates: Candidate[] }[] = [
    ...(input.override
      ? [
          {
            origin: "override" as const,
            candidates: [{ name: "chrome" as const, path: input.override }],
          },
        ]
      : []),
    { origin: "env", candidates: envCandidates(probe) },
    { origin: "standard", candidates: standardCandidates(probe) },
    { origin: "path", candidates: pathCandidates(probe) },
    { origin: "playwright-cache", candidates: cacheCandidates(probe, "playwright") },
    { origin: "puppeteer-cache", candidates: cacheCandidates(probe, "puppeteer") },
  ];

  const tried: string[] = [];
  for (const level of levels) {
    for (const item of level.candidates) {
      tried.push(item.path);
      if (probe.exists(item.path)) {
        return { browser: { path: item.path, name: item.name, origin: level.origin }, tried };
      }
    }
  }
  return { browser: null, tried };
};

const INSTALL_HINT =
  "装一个 Chrome / Edge / Chromium 即可（也可以在 browser_open 里传 executablePath，或设 CHROME_PATH）";

/** 探测失败的文案：列出试过的路径（截断），再给可操作的下一步 */
export const detectFailureMessage = (result: DetectResult): string => {
  if (result.browser) return "";
  const shown = result.tried.slice(0, BROWSER_DETECT_TRIED_MAX).join("、");
  const more =
    result.tried.length > BROWSER_DETECT_TRIED_MAX
      ? `（另有 ${result.tried.length - BROWSER_DETECT_TRIED_MAX} 处）`
      : "";
  return `找不到可用的浏览器；试过：${shown}${more}；${INSTALL_HINT}`;
};

let cachedBrowser: DetectedBrowser | null = null;

/** 进程内缓存一次成功的探测结果；失败不缓存（用户可能刚装好浏览器） */
export const resolveBrowser = (override?: string): DetectResult => {
  if (override) return detectBrowser({ override });
  if (cachedBrowser) return { browser: cachedBrowser, tried: [] };
  const result = detectBrowser();
  if (result.browser) cachedBrowser = result.browser;
  return result;
};

/** 测试与排障用：丢掉进程内缓存 */
export const resetBrowserDetectionCache = (): void => {
  cachedBrowser = null;
};
