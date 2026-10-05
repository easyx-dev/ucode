/**
 * 国际化守卫（见 AGENTS.md「语言规范」）。
 *
 * 约定：key 就是中文文案（含 `{{占位}}`）；缺失时 i18next 回退到 key 本身并照常插值，
 * 所以 zh-CN 目录只登记「纯占位模板」这类摘要 key（形如 `分组.用途`），`en.ts` 是完整目录。
 *
 * 1. 目录范围：每条 zh-CN key 必须在对应 en 目录里存在（zh ⊆ en），且只能是摘要 key；
 *    en 里的摘要 key 必须有 zh-CN 文案，否则中文界面会露出摘要 key。中文原文 key 无需重复登记。
 * 2. 冗余：zh-CN 里 key === value 的条目没有意义（回退即可），报错要求删除。
 * 3. 合并冲突：同一语言下 common / domain / ui 之间不得有重复 key（运行时扁平合并会静默覆盖）。
 * 4. 错误码映射：`errorMessageKeys` 的每个值都必须在 domain en 目录里存在（覆盖性由类型保证）。
 * 5. 硬编码中文（只扫 `apps/web/src`、`packages/ui/src` 与 `packages/i18n/src`）：中文必须走 `t(...)`；
 *    注释、`logger` / `console` 日志与带 `i18n-ignore` 标记的行除外。服务端不做本地化，
 *    它的中文是固定兜底文案与日志，不在扫描范围。
 *
 * 第 5 条是启发式的：不解析 AST，只认同行 `t("…")`，以及「上一行以 `t(` 结尾」的折行 key
 * （长 key 会被 Biome 折到下一行）。这样漏翻会立刻在 `pnpm check` 暴露。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { errorMessageKeys } from "../../../packages/i18n/src/error-messages.ts";
import commonEn from "../../../packages/i18n/src/locales/common/en.ts";
import commonZhCN from "../../../packages/i18n/src/locales/common/zh-CN.ts";
import domainEn from "../../../packages/i18n/src/locales/domain/en.ts";
import domainZhCN from "../../../packages/i18n/src/locales/domain/zh-CN.ts";
import uiEn from "../../../packages/i18n/src/locales/ui/en.ts";
import uiZhCN from "../../../packages/i18n/src/locales/ui/zh-CN.ts";
import { listFiles } from "../files.ts";

const HAN = /[\u4e00-\u9fff]/;
/** 已国际化的位置：key 与调用同行，如 `t("…")` */
const TRANSLATED = /\bt\(\s*["'`]/;
/** 折行形式：上一行以 `t(` 结尾时，本行是它的 key（Biome 对长 key 的折行） */
const TRANSLATE_OPEN = /\bt\(\s*$/;
/** 允许出现中文（非界面文案）的调用：日志 */
const SUPPRESS_CALL = /(?:logger|console)\.\w+\(/;
const IGNORE = "i18n-ignore";

/**
 * 不参与「硬编码中文」扫描的文件：
 * - 目录文件本身就是文案数据；
 * - `error-messages.ts` 是「错误码 → 文案 key」的映射，值就是 key。
 */
const isCatalogData = (path: string): boolean =>
  path.includes("/locales/") || path.endsWith("packages/i18n/src/error-messages.ts");

type Catalog = Record<string, string>;

/** 文案组：同属一份扁平 translation，故组间不得重名 */
const GROUPS: Array<{ label: string; zh: Catalog; en: Catalog }> = [
  { label: "packages/i18n common", zh: commonZhCN, en: commonEn },
  { label: "packages/i18n domain", zh: domainZhCN, en: domainEn },
  { label: "packages/i18n ui", zh: uiZhCN, en: uiEn },
];

/**
 * 摘要 key：形如 `分组.用途`（每段只含汉字 / 字母 / 数字 / 下划线），
 * 用于「key 本身无法表达语义」的纯占位模板（如 `失败提示.模板`）。
 * 中文原文 key 即使含 ASCII 点（如 `settings.yml`）也不算摘要 key。
 */
const SUMMARY_KEY = /^[\p{Script=Han}\w]+(?:\.[\p{Script=Han}\w]+)+$/u;
const isSummaryKey = (key: string): boolean => SUMMARY_KEY.test(key);

/** zh-CN 是 en 的子集，且只登记摘要 key：中文原文 key 靠回退，摘要 key 必须有中文 */
const catalogProblems = (): string[] => {
  const problems: string[] = [];
  for (const { label, zh, en } of GROUPS) {
    for (const [key, value] of Object.entries(zh)) {
      if (!(key in en)) problems.push(`${label}：zh-CN 的 key「${key}」不在 en 目录里`);
      if (!isSummaryKey(key)) {
        problems.push(
          `${label}：zh-CN 的 key「${key}」不是摘要 key；中文原文 key 无需登记（缺失时会回退为 key）`,
        );
      }
      if (key === value) {
        problems.push(
          `${label}：「${key}」的 zh-CN 值与 key 相同，属冗余条目（缺失时会回退为 key），请删除`,
        );
      }
    }
    for (const key of Object.keys(en)) {
      if (isSummaryKey(key) && !(key in zh)) {
        problems.push(`${label}：摘要 key「${key}」缺少 zh-CN 文案`);
      }
    }
  }
  return problems;
};

/** 同一语言下组间不得有重复 key（扁平合并会静默覆盖） */ const duplicateProblems =
  (): string[] => {
    const problems: string[] = [];
    for (const field of ["zh", "en"] as const) {
      const seen = new Map<string, string>();
      for (const group of GROUPS) {
        for (const key of Object.keys(group[field])) {
          const owner = seen.get(key);
          if (owner) {
            problems.push(
              `「${key}」同时出现在 ${owner} 与 ${group.label}（${field}），合并会覆盖`,
            );
          } else {
            seen.set(key, group.label);
          }
        }
      }
    }
    return problems;
  };

/** 错误码映射到的文案 key 必须在 domain en 目录里存在（中文缺失时回退为 key 本身） */
const errorKeyProblems = (): string[] =>
  Object.values(errorMessageKeys).flatMap((key) => {
    const problems: string[] = [];
    if (!(key in domainEn)) {
      problems.push(`errorMessageKeys 映射的「${key}」不在 domain en 目录里`);
    }
    return problems;
  });

/** 去掉行注释与块注释，保留字符串内容（字符串里也可能有中文） */
const stripComments = (line: string, state: { block: boolean }): string => {
  let out = "";
  let quote: string | null = null;
  let i = 0;
  while (i < line.length) {
    const ch = line[i] ?? "";
    const next = line[i + 1];
    if (state.block) {
      if (ch === "*" && next === "/") {
        state.block = false;
        i += 2;
      } else {
        i += 1;
      }
      continue;
    }
    if (quote) {
      out += ch;
      if (ch === "\\") {
        out += next ?? "";
        i += 2;
        continue;
      }
      if (ch === quote) quote = null;
      i += 1;
      continue;
    }
    if (ch === "/" && next === "/") break;
    if (ch === "/" && next === "*") {
      state.block = true;
      i += 2;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      out += ch;
      i += 1;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
};

const parenDelta = (text: string): number => {
  let depth = 0;
  for (const ch of text) {
    if (ch === "(") depth += 1;
    else if (ch === ")") depth -= 1;
  }
  return depth;
};

/** 扫描单个文件里未国际化的中文，返回问题清单 */
const hardcodedProblems = (root: string, file: string): string[] => {
  const problems: string[] = [];
  const state = { block: false };
  // 正在被豁免的调用（日志 / AppError）的括号深度
  let suppressedDepth = 0;
  // 上一行以 `t(` 结尾：本行是折行的 key，豁免
  let translationKeyLine = false;
  // 上一行是纯注释且带 i18n-ignore 时，豁免本行
  let ignoreNext = false;

  const lines = readFileSync(join(root, file), "utf8").split("\n");
  for (const [index, raw] of lines.entries()) {
    const hasMarker = raw.includes(IGNORE);
    const code = stripComments(raw, state);
    const stripped = code.trim();

    if (suppressedDepth > 0) {
      suppressedDepth = Math.max(0, suppressedDepth + parenDelta(code));
    } else {
      const call = SUPPRESS_CALL.exec(code);
      if (call) {
        suppressedDepth = Math.max(0, parenDelta(code.slice(code.indexOf("(", call.index))));
      } else if (
        !hasMarker &&
        !ignoreNext &&
        stripped.length > 0 &&
        HAN.test(code) &&
        !TRANSLATED.test(code) &&
        !translationKeyLine
      ) {
        problems.push(`${file}:${index + 1}：出现未国际化的中文，请改用 t("…") 或加 i18n-ignore`);
      }
    }

    translationKeyLine = TRANSLATE_OPEN.test(code);
    ignoreNext = hasMarker && stripped.length === 0;
  }

  return problems;
};

/**
 * 扫描范围内的硬编码中文。
 *
 * 只扫客户端与文案包：服务端已不做本地化，它的中文是「固定兜底文案 + 日志」，按设计允许。
 */
const sourceProblems = (root: string): string[] =>
  ["apps/web/src", "apps/desktop/src/renderer", "packages/ui/src", "packages/i18n/src"].flatMap(
    (dir) =>
      listFiles(root, dir, (path) => /\.tsx?$/.test(path))
        .filter((file) => !isCatalogData(file))
        .flatMap((file) => hardcodedProblems(root, file)),
  );

export const run = (root: string): string[] => [
  ...catalogProblems(),
  ...duplicateProblems(),
  ...errorKeyProblems(),
  ...sourceProblems(root),
];
