/**
 * 门禁自测：证明两道门禁真的会拦人，而不是"配置存在"。
 *
 * 分两类证据：
 *  - 合成工作区（临时目录里造包与策略）：逐条覆盖每种违规分支，不污染真实仓库；
 *  - 真实仓库：注入一处真实违规（绑定层导入核心层），证明真实策略确实拦得住。
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getBrand } from "@ucode/branding";
import { afterAll, describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

function runGate(script: string, root?: string): { status: number; output: string } {
  const args = [join(ROOT, "tools", script)];
  if (root !== undefined) args.push("--root", root);
  const result = spawnSync(process.execPath, args, { cwd: ROOT, encoding: "utf8" });
  return { status: result.status ?? -1, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

type FakePackage = {
  name: string;
  dependencies?: Record<string, string>;
  files?: Record<string, string>;
};

const tempRoots: string[] = [];

function makeWorkspace(
  allowList: Record<string, string[]>,
  packages: FakePackage[],
  extra: Record<string, unknown> = {},
): string {
  const root = mkdtempSync(join(tmpdir(), "gate-probe-"));
  tempRoots.push(root);
  mkdirSync(join(root, "tools"), { recursive: true });
  writeFileSync(
    join(root, "tools", "boundaries.json"),
    JSON.stringify(
      {
        allowList,
        forbiddenTransitive: {},
        alwaysAllowedExternals: [],
        allowComputedDynamicImports: [],
        ...extra,
      },
      null,
      2,
    ),
  );
  for (const pkg of packages) {
    const dir = join(root, "packages", pkg.name.replace(/^@[^/]+\//, ""));
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify(
        { name: pkg.name, version: "0.0.0", dependencies: pkg.dependencies ?? {} },
        null,
        2,
      ),
    );
    for (const [file, content] of Object.entries(pkg.files ?? {})) {
      writeFileSync(join(dir, "src", file), content);
    }
  }
  return root;
}

afterAll(() => {
  for (const root of tempRoots) rmSync(root, { recursive: true, force: true });
});

describe("依赖边界门禁 · 合成工作区", () => {
  const allowList = { "@ucode/alpha": [], "@ucode/beta": ["@ucode/alpha"] };

  it("合法依赖图：通过", () => {
    const root = makeWorkspace(allowList, [
      { name: "@ucode/alpha", files: { "index.ts": "export const a = 1;\n" } },
      {
        name: "@ucode/beta",
        dependencies: { "@ucode/alpha": "workspace:*" },
        files: { "index.ts": 'import { a } from "@ucode/alpha";\nexport const b = a;\n' },
      },
    ]);
    const { status, output } = runGate("check-boundaries.ts", root);
    expect(output).toContain("通过");
    expect(status).toBe(0);
  });

  it("导入不在允许列表内的内部包：被拦", () => {
    const root = makeWorkspace({ "@ucode/alpha": [], "@ucode/beta": [] }, [
      { name: "@ucode/alpha", files: { "index.ts": "export const a = 1;\n" } },
      { name: "@ucode/beta", files: { "index.ts": 'import { a } from "@ucode/alpha";\n' } },
    ]);
    const { status, output } = runGate("check-boundaries.ts", root);
    expect(output).toContain("不在允许列表内");
    expect(status).toBe(1);
  });

  it("声明了禁止的内部依赖（尚未导入）：被拦", () => {
    const root = makeWorkspace({ "@ucode/alpha": [], "@ucode/beta": [] }, [
      { name: "@ucode/alpha", dependencies: { "@ucode/beta": "workspace:*" } },
      { name: "@ucode/beta" },
    ]);
    const { status, output } = runGate("check-boundaries.ts", root);
    expect(output).toContain("声明了禁止的内部依赖");
    expect(status).toBe(1);
  });

  it("新增包未登记允许列表：被拦", () => {
    const root = makeWorkspace({ "@ucode/alpha": [] }, [
      { name: "@ucode/alpha" },
      { name: "@ucode/gamma" },
    ]);
    const { status, output } = runGate("check-boundaries.ts", root);
    expect(output).toContain("未在 tools/boundaries.json");
    expect(status).toBe(1);
  });

  it("相对导入逃出本包目录：被拦", () => {
    const root = makeWorkspace(allowList, [
      { name: "@ucode/alpha" },
      {
        name: "@ucode/beta",
        files: { "index.ts": 'import { a } from "../../alpha/src/index.ts";\n' },
      },
    ]);
    const { status, output } = runGate("check-boundaries.ts", root);
    expect(output).toContain("逃出本包目录");
    expect(status).toBe(1);
  });

  it("导入未声明的外部依赖：被拦", () => {
    const root = makeWorkspace(allowList, [
      { name: "@ucode/alpha", files: { "index.ts": 'import x from "left-pad";\n' } },
    ]);
    const { status, output } = runGate("check-boundaries.ts", root);
    expect(output).toContain("外部依赖");
    expect(status).toBe(1);
  });

  it("传递依赖里出现禁止的包：被拦", () => {
    const root = makeWorkspace(
      { "@ucode/alpha": [], "@ucode/beta": ["@ucode/alpha"], "@ucode/gamma": ["@ucode/beta"] },
      [
        { name: "@ucode/alpha" },
        { name: "@ucode/beta", dependencies: { "@ucode/alpha": "workspace:*" } },
        { name: "@ucode/gamma", dependencies: { "@ucode/beta": "workspace:*" } },
      ],
      { forbiddenTransitive: { "@ucode/gamma": ["@ucode/alpha"] } },
    );
    const { status, output } = runGate("check-boundaries.ts", root);
    expect(output).toContain("传递依赖");
    expect(status).toBe(1);
  });
});

describe("依赖边界门禁 · 真实仓库", () => {
  it("基线：当前仓库通过", () => {
    const { status, output } = runGate("check-boundaries.ts");
    expect(output).toContain("通过");
    expect(status).toBe(0);
  });

  it("绑定层导入核心层：被拦（真实策略）", () => {
    const probe = join(ROOT, "packages/bindings/stdio/src/__gate_probe-boundary.ts");
    try {
      writeFileSync(probe, 'import type { Core } from "@ucode/core";\nexport type X = Core;\n');
      const { status, output } = runGate("check-boundaries.ts");
      expect(output).toContain("@ucode/core");
      expect(status).toBe(1);
    } finally {
      rmSync(probe, { force: true });
    }
  });
});

describe("品牌字面量门禁", () => {
  it("基线：当前仓库通过", () => {
    const { status } = runGate("check-brand-literals.ts");
    expect(status).toBe(0);
  });

  it("源码写死品牌字面量：被拦，且报出最具体的那个值", () => {
    const literal = getBrand().dataDirName;
    const root = makeWorkspace({}, []);
    mkdirSync(join(root, "apps/web/src"), { recursive: true });
    writeFileSync(join(root, "apps/web/src/index.ts"), `export const home = "~/${literal}";\n`);
    const { status, output } = runGate("check-brand-literals.ts", root);
    expect(output).toContain("apps/web/src/index.ts:1");
    expect(output).toContain(literal);
    expect(status).toBe(1);
  });

  it("包 scope 标识不算违规", () => {
    const scope = `@${getBrand().productName}/protocol`;
    const root = makeWorkspace({}, []);
    mkdirSync(join(root, "apps/web/src"), { recursive: true });
    writeFileSync(join(root, "apps/web/src/index.ts"), `import type { X } from "${scope}";\n`);
    const { status } = runGate("check-brand-literals.ts", root);
    expect(status).toBe(0);
  });

  it("临时目录里既无源码也无根配置文件：不误报", () => {
    const root = makeWorkspace({}, []);
    const { status } = runGate("check-brand-literals.ts", root);
    expect(status).toBe(0);
  });

  it("真实仓库基线不受临时目录影响", () => {
    const { status } = runGate("check-brand-literals.ts", resolve(ROOT));
    expect(status).toBe(0);
  });
});
