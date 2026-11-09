/**
 * 方言 → 载荷：容器摘出去当命令 / 技能（各自的参数），其余文本按行内记号换成位置标记。
 *
 * 两侧共用同一份标记字面量（`@ucode/contracts` 的 markers）：解析产物因此与今天的载荷形态完全一致，
 * 服务端一行都不用改——它照旧按 `@路径` / `图片 N` / `附件 N.ext` 展开。
 *
 * 顺序口径：附件按**文档顺序**编号（容器与正文一视同仁），图片与非图片各自从 1 起；引用按
 * 「路径 + 行范围」去重，正文里的多处标记都留着。
 */
import {
  type AttachmentRef,
  attachmentMarker,
  type ContextRef,
  contextMarker,
  imageMarker,
} from "@ucode/contracts";
import { type ContainerFence, scanContainers } from "./containers.ts";
import { scanInline } from "./inline.ts";
import { nonParsedIntervals, parseMarkdownTree } from "./regions.ts";
import type {
  DialectCommand,
  DialectDiagnostic,
  DialectDocument,
  DialectSkill,
  InvocationCandidates,
} from "./types.ts";

type Target = { fence: ContainerFence | null; from: number; to: number };

/** 容器摘掉之后的正文：收敛接缝处的空行，别把「容器前后的空行」当成用户写的空行 */
const normalizeProse = (pieces: readonly string[]): string =>
  pieces
    .join("")
    .trim()
    .replaceAll(/\n{3,}/g, "\n\n");

const targetsOf = (markdown: string, fences: readonly ContainerFence[]): Target[] => {
  const targets: Target[] = [];
  let cursor = 0;
  for (const fence of fences) {
    if (fence.from > cursor) targets.push({ fence: null, from: cursor, to: fence.from });
    targets.push({ fence, from: fence.contentFrom, to: fence.contentTo });
    cursor = fence.to;
  }
  if (cursor < markdown.length) targets.push({ fence: null, from: cursor, to: markdown.length });
  return targets;
};

export const parseDialect = (
  markdown: string,
  candidates: InvocationCandidates,
): DialectDocument => {
  const skipped = nonParsedIntervals(parseMarkdownTree(markdown));
  const fences = scanContainers(markdown, skipped);

  const diagnostics: DialectDiagnostic[] = [];
  const args = new Map<ContainerFence, string>();
  const contexts: ContextRef[] = [];
  const seenContexts = new Set<string>();
  const attachments: AttachmentRef[] = [];
  const prose: string[] = [];
  let imageCount = 0;
  let fileCount = 0;

  for (const target of targetsOf(markdown, fences)) {
    const scan = scanInline(markdown, target, skipped, candidates.mentions ?? []);
    let text = "";
    for (const token of scan.tokens) {
      if (token.kind === "text") {
        text += token.text;
        continue;
      }
      if (token.kind === "context") {
        const key = `${token.path}#${token.startLine ?? ""}-${token.endLine ?? ""}`;
        if (!seenContexts.has(key)) {
          seenContexts.add(key);
          contexts.push({
            path: token.path,
            ...(token.startLine ? { startLine: token.startLine } : {}),
            ...(token.endLine ? { endLine: token.endLine } : {}),
          });
        }
        text += contextMarker(token.path);
        continue;
      }
      attachments.push({ id: token.id });
      text +=
        token.schemeKind === "image"
          ? imageMarker(imageCount++)
          : attachmentMarker(fileCount++, token.name);
    }
    for (const invalid of scan.invalidAttachments) {
      diagnostics.push({ code: "attachment-invalid", raw: invalid.raw, offset: invalid.offset });
    }
    if (target.fence) args.set(target.fence, text.trim());
    else prose.push(text);
  }

  let command: DialectCommand | undefined;
  const skills: DialectSkill[] = [];
  for (const fence of fences) {
    const fenceArgs = args.get(fence) ?? "";
    if (!fence.closed)
      diagnostics.push({ code: "container-unclosed", name: fence.name, offset: fence.offset });
    if (fence.nestedAt !== null) {
      diagnostics.push({ code: "container-nested", name: fence.name, offset: fence.nestedAt });
    }
    if (fence.kind === "skill") {
      if (!candidates.skills.some((item) => item.name === fence.name)) {
        diagnostics.push({ code: "skill-unknown", name: fence.name, offset: fence.offset });
      }
      skills.push({ name: fence.name, args: fenceArgs });
      continue;
    }
    if (!command) {
      if (!candidates.prompts.some((item) => item.name === fence.name)) {
        diagnostics.push({ code: "command-unknown", name: fence.name, offset: fence.offset });
      }
      command = { name: fence.name, args: fenceArgs };
      continue;
    }
    diagnostics.push({ code: "command-duplicated", name: fence.name, offset: fence.offset });
  }

  return {
    ...(command ? { command } : {}),
    skills,
    text: normalizeProse(prose),
    contexts,
    attachments,
    diagnostics,
  };
};
