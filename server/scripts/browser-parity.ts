/**
 * 与真 agent-browser 的对拍：同一批本地页面，两边各取一次快照比较**元素覆盖**，
 * 再跑同一串动作比较**可观察结果**（谁是遮挡、谁快、谁变）。
 *
 * 为什么对这两件事而不是编号：编号算法（`role + 名字` 哈希）是本项目自主选择、agent-browser 未公开，
 * 对不出「一致」；真正要对齐的是「同一页面上，我们认出的可操作元素是不是它认出的那批」与
 * 「同一个操作在两边产生同样的可观察结果」。
 *
 * 结论写进 `.tmp/browser-parity-report.md`（临时产物，不放仓库长期文件里）。
 * 依赖本机装了 agent-browser，因此**不进 `pnpm test`**；用法：
 * `pnpm -F @ucode/server exec tsx scripts/browser-parity.ts`。
 */
import { writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";

import { execa } from "execa";

import { createBrowserSession } from "../src/harness/features/browser/session";

type OurEntry = { ref: string; role: string; name: string; state?: string };

type Page = {
  path: string;
  title: string;
  html: string;
  /** 两边都跑的动作序列（按元素的可访问名定位） */
  actions?: Action[];
};

type Action = { expect?: string } & (
  | { kind: "fill"; name: string; text: string }
  | { kind: "click"; name: string }
  | { kind: "select"; name: string; value: string }
  | { kind: "check"; name: string }
);

const head = (title: string): string =>
  `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8" /><title>${title}</title></head><body>`;

/** 每个页面都带一个 role=status 的元素：动作的可观察结果都写进它，两边都能读到 */
const pages: Page[] = [
  {
    path: "/basic",
    title: "基本控件",
    html: `${head("基本控件")}
      <h1>基本控件</h1>
      <label for="name">名字</label><input id="name" placeholder="请输入名字" />
      <button id="greet">问候</button>
      <button disabled>禁用按钮</button>
      <p role="status" id="status">（未问候）</p>
      <div style="height:2000px"></div>
      <button id="far">视口外的按钮</button>
      <script>
        document.getElementById("greet").addEventListener("click", () => {
          document.getElementById("status").textContent =
            "你好，" + (document.getElementById("name").value || "陌生人");
        });
      </script>`,
    actions: [
      // fill 本身不改状态文本：这一步只比较「两边都成功」
      { kind: "fill", name: "名字", text: "对拍" },
      { kind: "click", name: "问候", expect: "你好，对拍" },
    ],
  },
  {
    path: "/forms",
    title: "表单与链接",
    html: `${head("表单与链接")}
      <h1>表单与链接</h1>
      <a href="/basic">去基本控件</a>
      <button aria-label="关闭">×</button>
      <label>城市 <select id="city"><option value="bj">北京</option><option value="sh">上海</option></select></label>
      <label><input type="checkbox" id="agree" /> 同意条款</label>
      <label><input type="radio" name="plan" id="plan-a" /> 方案 A</label>
      <textarea id="note" placeholder="备注"></textarea>
      <p role="status" id="status">（未操作）</p>
      <script>
        document.getElementById("city").addEventListener("change", (event) => {
          document.getElementById("status").textContent = "城市=" + event.target.value;
        });
        document.getElementById("agree").addEventListener("change", (event) => {
          document.getElementById("status").textContent = event.target.checked ? "已勾选" : "未勾选";
        });
      </script>`,
    actions: [
      { kind: "select", name: "城市", value: "sh", expect: "城市=sh" },
      { kind: "check", name: "同意条款", expect: "已勾选" },
    ],
  },
  {
    path: "/duplicates",
    title: "同名元素",
    html: `${head("同名元素")}
      <h1>同名元素</h1>
      <button id="a">确定</button><button id="b">确定</button><button id="c">确定</button>
      <p role="status" id="status">（未点击）</p>
      <script>
        for (const id of ["a", "b", "c"]) {
          document.getElementById(id).addEventListener("click", () => {
            document.getElementById("status").textContent = "点了 " + id;
          });
        }
      </script>`,
    actions: [{ kind: "click", name: "确定", expect: "点了 " }],
  },
  {
    path: "/overlay",
    title: "遮挡",
    html: `${head("遮挡")}
      <h1>遮挡</h1>
      <button id="target">被遮住的目标</button>
      <p role="status" id="status">（未点击）</p>
      <div id="mask" style="position:fixed;inset:0;background:rgba(0,0,0,.4)">
        <button id="dismiss">关闭遮罩</button>
      </div>
      <script>
        document.getElementById("target").addEventListener("click", () => {
          document.getElementById("status").textContent = "点到了目标";
        });
        document.getElementById("dismiss").addEventListener("click", () => {
          document.getElementById("mask").style.display = "none";
        });
      </script>`,
    // 遮挡：两边都该「点不到」——status 保持未点击
    actions: [{ kind: "click", name: "被遮住的目标", expect: "（未点击）" }],
  },
  {
    path: "/dynamic",
    title: "动态插入",
    html: `${head("动态插入")}
      <h1>动态插入</h1>
      <button id="add">加一个按钮</button>
      <p role="status" id="status">（还没加）</p>
      <script>
        document.getElementById("add").addEventListener("click", () => {
          const extra = document.createElement("button");
          extra.textContent = "新按钮";
          document.body.appendChild(extra);
          document.getElementById("status").textContent = "已加一个新按钮";
        });
      </script>`,
    actions: [{ kind: "click", name: "加一个按钮", expect: "已加一个新按钮" }],
  },
];

/** 我们这边的快照行：`@e1a2 button "登录" [禁用]` */
const parseOurSnapshot = (text: string): OurEntry[] => {
  const entries: OurEntry[] = [];
  for (const line of text.split("\n")) {
    const matched = /^@(\w+) (\S+) "(.*)"(?: \[(.*)\])?$/.exec(line.trim());
    if (!matched) continue;
    entries.push({
      ref: matched[1] ?? "",
      role: matched[2] ?? "",
      name: matched[3] ?? "",
      ...(matched[4] ? { state: matched[4] } : {}),
    });
  }
  return entries;
};

/** 可访问名归一：折叠空白；我们这边超上限会带 `…`，比较时按前缀算 */
const normalizeName = (name: string): string => name.replace(/\s+/g, " ").trim();

const isTruncated = (name: string): boolean => name.endsWith("…");

type TheirRef = { role: string; name: string; ref: string };

/** 他们那边的页面状态：refs 里只有交互元素与少量结构，状态文本要读渲染后的 DOM */
const theirPageText = async (): Promise<string> => {
  const result = await execa("agent-browser", ["read"], { timeout: 60_000, reject: false });
  return normalizeName(result.stdout ?? "");
};

const theirSnapshot = async (): Promise<{ refs: TheirRef[]; status: string | null }> => {
  const result = await execa("agent-browser", ["snapshot", "--json"], { timeout: 60_000 });
  const parsed = JSON.parse(result.stdout) as {
    data: { refs: Record<string, { role: string; name: string }> };
  };
  const refs = Object.entries(parsed.data.refs).map(([ref, value]) => ({
    ref,
    role: value.role,
    name: normalizeName(value.name),
  }));
  const status = refs.find((item) => item.role === "status")?.name ?? null;
  return { refs, status };
};

/** 两边的元素集合比较：共有 / 我们漏 / 我们多 */
const compareCoverage = (ours: OurEntry[], theirs: TheirRef[]) => {
  // 同名元素会有多条：按「一对一消耗」匹配，否则三个「确定」只会配上一条
  const unmatched = [...theirs];
  /** 我们有、他们没有 */
  const oursOnly: string[] = [];
  const shared: string[] = [];

  for (const entry of ours) {
    const name = normalizeName(entry.name);
    const exactAt = unmatched.findIndex((item) => item.role === entry.role && item.name === name);
    if (exactAt >= 0) {
      unmatched.splice(exactAt, 1);
      shared.push(`${entry.role} "${name}"`);
      continue;
    }
    // 我们截断了名字：按前缀找他们的同名元素
    if (isTruncated(entry.name)) {
      const prefix = name.slice(0, -1);
      const prefixAt = unmatched.findIndex(
        (item) => item.role === entry.role && item.name.startsWith(prefix),
      );
      if (prefixAt >= 0) {
        const hit = unmatched[prefixAt];
        unmatched.splice(prefixAt, 1);
        shared.push(`${entry.role} "${name}"（我们截断，他们 "${hit?.name ?? ""}"）`);
        continue;
      }
    }
    oursOnly.push(`${entry.role} "${name}"`);
  }

  /** 他们有、我们没有 */
  const theirsOnly = unmatched.map((item) => `${item.role} "${item.name}"`);
  return { shared, oursOnly, theirsOnly };
};

/** 我们的动作执行：按名字找 ref，再走会话的 act */
const actOurs = async (
  session: ReturnType<typeof createBrowserSession>,
  entries: OurEntry[],
  action: Action,
): Promise<string> => {
  const locate = (name: string): OurEntry | undefined =>
    entries.find(
      (entry) =>
        entry.name === name ||
        (isTruncated(entry.name) && name.startsWith(entry.name.slice(0, -1))),
    );
  const target = locate(action.name);
  if (!target) return `未找到元素「${action.name}」`;
  try {
    if (action.kind === "fill") {
      const result = await session.act({ action: "fill", ref: target.ref, text: action.text });
      return result.summary;
    }
    if (action.kind === "click") {
      const result = await session.act({ action: "click", ref: target.ref });
      return result.summary;
    }
    if (action.kind === "select") {
      const result = await session.act({ action: "select", ref: target.ref, text: action.value });
      return result.summary;
    }
    // 勾选走 click：复选框的 click 就是切换
    const result = await session.act({ action: "click", ref: target.ref });
    return result.summary;
  } catch (error) {
    const described = error as { code?: string; message?: string };
    return `失败(${described.code ?? "unknown"})：${(described.message ?? "").slice(0, 80)}`;
  }
};

const actTheirs = async (refs: TheirRef[], action: Action): Promise<string> => {
  const target = refs.find((item) => item.name === action.name);
  if (!target) return `未找到元素「${action.name}」`;
  try {
    if (action.kind === "fill") {
      await execa("agent-browser", ["fill", `@${target.ref}`, action.text], { timeout: 60_000 });
    } else if (action.kind === "select") {
      await execa("agent-browser", ["select", `@${target.ref}`, action.value], { timeout: 60_000 });
    } else if (action.kind === "check") {
      await execa("agent-browser", ["check", `@${target.ref}`], { timeout: 60_000 });
    } else {
      await execa("agent-browser", ["click", `@${target.ref}`], { timeout: 60_000 });
    }
    return `${action.kind} 成功`;
  } catch (error) {
    const result = error as {
      stdout?: string;
      stderr?: string;
      shortMessage?: string;
      message?: string;
    };
    const detail = (result.stdout ?? result.stderr ?? result.shortMessage ?? result.message ?? "")
      .replace(/\s+/g, " ")
      .trim();
    return `失败：${detail.slice(0, 120)}`;
  }
};

const main = async (): Promise<void> => {
  const server = createServer((request, response) => {
    const path = (request.url ?? "/").split("?")[0] ?? "/";
    const page = pages.find((item) => item.path === path);
    response.writeHead(page ? 200 : 404, { "content-type": "text/html; charset=utf-8" });
    response.end(page ? page.html : "<!doctype html><title>404</title>");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const session = createBrowserSession({ profile: "parity", mode: "isolated" });
  const report: string[] = [
    "# 与 agent-browser 的对拍记录",
    "",
    `- 页面：${pages.length} 个（本地静态页）`,
    "",
  ];

  try {
    for (const page of pages) {
      const url = `${origin}${page.path}`;
      await session.open({ url });
      const ours = parseOurSnapshot((await session.snapshot({})).text);

      await execa("agent-browser", ["open", url], { timeout: 60_000 });
      const theirs = await theirSnapshot();

      const coverage = compareCoverage(ours, theirs.refs);
      report.push(
        `## ${page.title}（${page.path}）`,
        "",
        `- 元素数：我们 ${ours.length}，agent-browser ${theirs.refs.length}`,
        `- 共有 ${coverage.shared.length}：${coverage.shared.join("、") || "无"}`,
        `- **我们有、他们没有** ${coverage.oursOnly.length}：${coverage.oursOnly.join("、") || "无"}`,
        `- **他们有、我们漏掉** ${coverage.theirsOnly.length}：${coverage.theirsOnly.join("、") || "无"}`,
        "",
      );
      console.log(`\n## ${page.title}（${page.path}）`);
      console.log(
        `  我们 ${ours.length} / 它们 ${theirs.refs.length}｜共有 ${coverage.shared.length}`,
      );
      if (coverage.oursOnly.length > 0)
        console.log(`  我们有他们没有：${coverage.oursOnly.join("、")}`);
      if (coverage.theirsOnly.length > 0)
        console.log(`  他们有我们漏掉：${coverage.theirsOnly.join("、")}`);

      if (!page.actions) continue;

      report.push("### 动作语义", "");
      console.log("  动作语义：");
      let oursEntries = ours;
      for (const action of page.actions) {
        const label = `${action.kind} 「${action.name}」`;
        const ourResult = await actOurs(session, oursEntries, action).catch((error: unknown) =>
          String(error),
        );
        const theirResult = await actTheirs(theirs.refs, action);

        // 两边各自读一次页面状态，看「期望的结果」有没有出现——比各自的快照形态更可比
        oursEntries = parseOurSnapshot((await session.snapshot({})).text);
        const ourText = oursEntries.map((entry) => `${entry.role} "${entry.name}"`).join("\n");
        const theirText = await theirPageText();
        if (action.expect === undefined) {
          const line = `| ${label} | ${ourResult} | ${theirResult} | 只比成功与否 |`;
          report.push(line);
          console.log(`    ${label}：我们「${ourResult}」/ 它们「${theirResult}」`);
          continue;
        }
        const ourHit = ourText.includes(action.expect);
        const theirHit = theirText.includes(action.expect);
        const same = ourHit === theirHit;

        const line = `| ${label} | ${ourResult} ｜含「${action.expect}」：${ourHit} | ${theirResult} ｜含「${action.expect}」：${theirHit} | ${same ? "一致" : "**差异**"} |`;
        report.push(line);
        console.log(
          `    ${label} → 期望「${action.expect}」：我们 ${ourHit ? "命中" : "未命中"} / 它们 ${theirHit ? "命中" : "未命中"}`,
        );
      }
      report.push("");
    }
  } finally {
    await session.close();
    await execa("agent-browser", ["close"], { timeout: 30_000, reject: false });
    server.close();
  }

  // 路径相对脚本本身解析：脚本可能从 server/ 目录起跑（cwd 不是仓库根）
  const reportPath = fileURLToPath(new URL("../../.tmp/browser-parity-report.md", import.meta.url));
  writeFileSync(reportPath, `${report.join("\n")}\n`);
  console.log(`\n报告已写入 ${reportPath}`);
};

await main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
