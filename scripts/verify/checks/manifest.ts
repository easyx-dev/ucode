/**
 * 依赖声明守卫。
 *
 * 1. 依赖镜像：`pnpm start` 跑的是 esbuild 产物 `dist/ucode.js`，第三方依赖被设为 external，运行时会从
 *    **入口所在仓库根**的 `node_modules` 解析——而依赖的事实源在 `server/package.json`（pnpm 隔离安装，
 *    那些包默认只在 `server/node_modules`）。所以根 `package.json` 必须声明同一批第三方依赖，
 *    漏一个就表现为 `pnpm start` 启动即 `Cannot find module`。工作区包由 esbuild 打进产物，不需要声明。
 * 2. 版本落点：跨包共用的依赖版本只写 `pnpm-workspace.yaml` 的 `catalog:`，各处写 `"catalog:"` 引用。
 *    谁又把版本写回自己包里、以及 catalog 里没人引用的死条目，都在这里拦下。
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
] as const;

type Manifest = {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
};

/** 不写具体版本的协议：不参与「同一版本写了多处」的判定 */
const NON_VERSION_PROTOCOL = /^(workspace|catalog|file|link|portal):/;

const readManifest = (root: string, dir: string): Manifest =>
  JSON.parse(readFileSync(join(root, dir, "package.json"), "utf8")) as Manifest;

/** `pnpm-workspace.yaml` 某个顶层键下的块（手写解析：本文件只用顶层键 + 一层列表 / 映射，够用） */
const yamlSection = (root: string, key: string): string[] => {
  const lines = readFileSync(join(root, "pnpm-workspace.yaml"), "utf8").split("\n");
  const start = lines.findIndex((line) => line === `${key}:` || line.startsWith(`${key}: `));
  if (start < 0) throw new Error(`pnpm-workspace.yaml 里找不到 ${key} 段`);

  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (!/^\s/.test(line)) break;
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    body.push(trimmed);
  }
  return body;
};

/** 工作区包目录：`packages` 段支持 `dir` 与 `dir/*` 两种写法（后者取一层子目录） */
const workspaceDirs = (root: string): string[] => {
  const dirs: string[] = [];
  for (const item of yamlSection(root, "packages")) {
    const glob = item.replace(/^-\s*/, "").replace(/^["']|["']$/g, "");
    if (!glob.endsWith("/*")) {
      dirs.push(glob);
      continue;
    }
    const parent = glob.slice(0, -2);
    for (const entry of readdirSync(join(root, parent), { withFileTypes: true })) {
      // pnpm 也只把带清单的目录当包；无关目录（如 `packages/tmp`、`packages/node_modules`）一律跳过
      if (!entry.isDirectory()) continue;
      if (existsSync(join(root, parent, entry.name, "package.json"))) {
        dirs.push(`${parent}/${entry.name}`);
      }
    }
  }
  return dirs;
};

const catalogNames = (root: string): string[] =>
  yamlSection(root, "catalog").map((line) => {
    const match = /^"?([^":]+)"?\s*:/.exec(line);
    if (!match?.[1]) throw new Error(`pnpm-workspace.yaml 的 catalog 里有认不出的条目：${line}`);
    return match[1];
  });

/** 依赖镜像：根 dependencies 覆盖 server 的第三方运行时依赖 */
const mirrorProblems = (rootManifest: Manifest, serverManifest: Manifest): string[] => {
  const problems: string[] = [];
  const rootDeps = rootManifest.dependencies ?? {};
  for (const [name, version] of Object.entries(serverManifest.dependencies ?? {})) {
    if (name.startsWith("@ucode/")) continue;
    const declared = rootDeps[name];
    if (declared === version) continue;
    problems.push(
      declared
        ? `package.json：dependencies.${name} 为 ${declared}，与 server 的 ${version} 不一致`
        : `package.json：缺少 dependencies.${name}（server 运行时依赖 ${version}，pnpm start 需要它）`,
    );
  }
  return problems;
};

/** 版本落点：跨包共用的依赖写进 catalog，catalog 里不留没人引用的条目 */
const catalogProblems = (root: string): string[] => {
  const problems: string[] = [];
  const declared = new Map<string, { specs: Set<string>; dirs: Set<string> }>();
  const referenced = new Set<string>();

  for (const dir of [".", ...workspaceDirs(root)]) {
    const manifest = readManifest(root, dir);
    for (const field of DEPENDENCY_FIELDS) {
      for (const [name, spec] of Object.entries(manifest[field] ?? {})) {
        if (NON_VERSION_PROTOCOL.test(spec)) {
          if (spec.startsWith("catalog:")) referenced.add(name);
          continue;
        }
        const entry = declared.get(name) ?? { specs: new Set<string>(), dirs: new Set<string>() };
        entry.specs.add(spec);
        entry.dirs.add(dir);
        declared.set(name, entry);
      }
    }
  }

  for (const [name, entry] of declared) {
    // 各包版本不一致时是有意分开写（如 React 19 与 18 并存），不拦
    if (entry.dirs.size < 2 || entry.specs.size > 1) continue;
    const [spec] = entry.specs;
    problems.push(
      `${[...entry.dirs].join(" / ")} 都写死了 ${name}@${spec}：跨包共用的依赖写进 pnpm-workspace.yaml 的 catalog，各处改用 "catalog:"`,
    );
  }
  for (const name of catalogNames(root)) {
    if (!referenced.has(name)) {
      problems.push(`pnpm-workspace.yaml：catalog.${name} 没有任何包引用，删掉它`);
    }
  }

  return problems;
};

export const run = (root: string): string[] => [
  ...mirrorProblems(readManifest(root, "."), readManifest(root, "server")),
  ...catalogProblems(root),
];
