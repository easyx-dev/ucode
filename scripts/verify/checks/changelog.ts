/**
 * 变更日志结构守卫（约定见 `CHANGELOG.md` 顶部的「规模上限」与「分节用词」）。
 *
 * 拦的是结构漂移而不是内容：追加条目时「新开一节」比「插进已有节」省事，于是同名小节重复出现，
 * 之后找位置只能靠反复 grep；而「未发布」攒着不落版会让主文件长到一次 `read` 读不完——
 * 正文一句没错，静态检查也照不出来。这里把规模与形状都变成显式失败。
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** 分节用词与顺序（见 CHANGELOG.md「分节用词」） */
const SECTIONS = ["新增", "变更", "修复", "移除"];
/** 主文件保留「未发布」+ 最近 3 个已发布版本的摘要 */
const MAX_VERSIONS = 4;
/** 未发布到这么多条就落版（详见顶部「规模上限」） */
const MAX_UNRELEASED_ENTRIES = 40;
/** 单个已发布版本的摘要条数：写「本版做了什么」，不逐条抄明细 */
const MAX_SUMMARY_ENTRIES = 16;
/** 主文件体积上限：`read` 是 50KB / 2000 行截断，留出余量 */
const MAX_BYTES = 45 * 1024;

type Version = {
  /** 标题行行号（1 起） */
  line: number;
  label: string;
  /** 该版本段内的顶层条目数 */
  entries: number;
};

type Parsed = {
  versions: Version[];
  /** 未发布段内的小节标题行号与名字 */
  sections: Array<{ line: number; title: string }>;
  /** 正文里引用的归档文件（`docs/changelog/<年份>.md`） */
  archives: string[];
};

/** 跳过 ``` 围栏里的模板（文件顶部的示例就含 `## [未发布]` 与 `### 新增`） */
const parse = (lines: string[]): Parsed => {
  const parsed: Parsed = { versions: [], sections: [], archives: [] };
  let inFence = false;
  let version: Version | null = null;

  lines.forEach((text, index) => {
    if (/^\s*```/.test(text)) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;

    const heading = /^## \[([^\]]+)\]/.exec(text);
    if (heading) {
      version = { line: index + 1, label: heading[1], entries: 0 };
      parsed.versions.push(version);
      return;
    }

    const section = /^### (.+?)\s*$/.exec(text);
    if (section && version?.label === "未发布") {
      parsed.sections.push({ line: index + 1, title: section[1] });
      return;
    }

    if (version && /^- /.test(text)) version.entries += 1;

    const archive = /docs\/changelog\/\d{4}\.md/.exec(text);
    if (archive) parsed.archives.push(archive[0]);
  });

  return parsed;
};

/** 版本号逐段比大小；任一侧解析失败时按相等处理（格式问题已单独报过） */
const compare = (a: number[] | null, b: number[] | null): number => {
  if (!a || !b) return 0;
  for (let i = 0; i < 3; i += 1) {
    const gap = a[i] - b[i];
    if (gap !== 0) return gap;
  }
  return 0;
};

export const run = (root: string): string[] => {
  const problems: string[] = [];
  const source = readFileSync(join(root, "CHANGELOG.md"), "utf8");
  const { versions, sections, archives } = parse(source.split("\n"));

  if (versions.length === 0 || versions[0].label !== "未发布") {
    problems.push(
      "CHANGELOG.md：第一个版本段必须是 `## [未发布]`（新条目加在这里，发布时整体归档）",
    );
  }

  const seen = new Map<string, number>();
  let previous = -1;
  for (const section of sections) {
    const order = SECTIONS.indexOf(section.title);
    if (order < 0) {
      problems.push(
        `CHANGELOG.md:${section.line}：小节名「${section.title}」不在 ${SECTIONS.join(" / ")} 里`,
      );
      continue;
    }
    const duplicate = seen.get(section.title);
    if (duplicate !== undefined) {
      problems.push(
        `CHANGELOG.md:${section.line}：未发布段里「${section.title}」已在小节处出现（第 ${duplicate} 行）——条目插进已有小节，不要新开一节`,
      );
      continue;
    }
    seen.set(section.title, section.line);
    if (order < previous) {
      problems.push(`CHANGELOG.md:${section.line}：小节顺序应为 ${SECTIONS.join(" → ")}`);
    }
    previous = order;
  }

  const [unreleased, ...released] = versions;
  if (unreleased && unreleased.entries > MAX_UNRELEASED_ENTRIES) {
    problems.push(
      `CHANGELOG.md:${unreleased.line}：未发布段已有 ${unreleased.entries} 条（上限 ${MAX_UNRELEASED_ENTRIES}）——落版（bump 根 package.json 的 version）并把明细移入 docs/changelog/<年份>.md`,
    );
  }

  for (const version of released) {
    if (version.entries > MAX_SUMMARY_ENTRIES) {
      problems.push(
        `CHANGELOG.md:${version.line}：${version.label} 有 ${version.entries} 条（摘要上限 ${MAX_SUMMARY_ENTRIES}）——主文件只留摘要，明细移入 docs/changelog/<年份>.md`,
      );
    }
  }

  if (versions.length > MAX_VERSIONS) {
    problems.push(
      `CHANGELOG.md：有 ${versions.length} 个版本段（上限 ${MAX_VERSIONS}：未发布 + 最近 3 个已发布版本）——最老的已发布版本整段移入 docs/changelog/<年份>.md，原位置只留一行链接`,
    );
  }

  const size = Buffer.byteLength(source, "utf8");
  if (size > MAX_BYTES) {
    problems.push(
      `CHANGELOG.md：已 ${Math.round(size / 1024)}KB（上限 ${MAX_BYTES / 1024}KB，read 是 50KB 截断）——明细移入 docs/changelog/<年份>.md，主文件只留摘要与链接`,
    );
  }

  const parsedVersions = released.map((version) => {
    const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version.label);
    return match ? match.slice(1).map(Number) : null;
  });
  parsedVersions.forEach((parsed, index) => {
    const version = released[index];
    if (!parsed) {
      problems.push(`CHANGELOG.md:${version.line}：版本号「${version.label}」应为 x.y.z`);
      return;
    }
    if (index > 0 && compare(parsedVersions[index - 1], parsed) < 0) {
      problems.push(`CHANGELOG.md:${version.line}：版本段要倒序（最新在上）`);
    }
  });

  for (const archive of new Set(archives)) {
    if (!existsSync(join(root, archive))) {
      problems.push(`CHANGELOG.md：引用了 ${archive}，但文件不存在`);
    }
  }

  return problems;
};
