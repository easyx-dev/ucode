/**
 * 用户消息的还原：前置展开块的剥离、正文里 `@` 标记的切分、技能 / 命令 / 附件 chip 的取出。
 *
 * 服务端把注入内容拼成前置块与正文一起落进会话条目（顺序见 `server/src/core/run.ts`）：
 *   <skill …>…</skill> / <command …>…</command> / <context …>…</context> / [附件: …] / 用户正文
 * 块内容只喂给模型，界面整体剥掉它们（不展开、不成段）：技能、命令、附件各自出 chip，
 * `@` 引用还原成正文里可点的标记。块内容已由服务端的 `neutralizeTags` 转义同名标签，
 * 因此匹配首个闭合标签是安全的。
 *
 * 解析是「段落化」的：一次扫完所有前置块，再用同一遍扫描把正文里的引用标记切出来。
 */
import type { ContextRef } from "@ucode/contracts";

import type { ComposerPayload } from "./composer-payload";
import { toRelativePath } from "./path";

export type SkillChip = { name: string };
/** 提示词命令：chip 显示 `/name`，用户写的参数跟在正文里 */
export type CommandChip = { name: string; args: string };
export type AttachmentChip = { id: string; name: string };

/** 正文的一段：普通文本，或一条引用标记（带引用时的行范围，供编辑重发时原样回传） */
export type UserTextSegment = { type: "text"; text: string } | ({ type: "context" } & ContextRef);

export type ParsedUserMessage = {
  skill?: SkillChip;
  command?: CommandChip;
  attachments: AttachmentChip[];
  /** 正文分段（引用标记已切出来），`text` 是它们的原始拼接 */
  segments: UserTextSegment[];
  /** 用户正文：剥掉全部前置展开块，`@` 引用标记留在用户写的那句话里 */
  text: string;
};

const SKILL_PATTERN = /^<skill name="([^"]*)" location="[^"]*">\n[\s\S]*?\n<\/skill>\n{0,2}/;
const COMMAND_PATTERN = /^<command name="([^"]*)" args="([^"]*)">\n[\s\S]*?\n<\/command>\n{0,2}/;
const CONTEXT_PATTERN =
  /^<context path="([^"]*)"(?: lines="([^"]*)")?>\n[\s\S]*?\n<\/context>\n{0,2}/;
/** 非图片附件的引用行（服务端前置进正文）：`[附件: name (id: <sha256>)]` */
// i18n-ignore：协议字面量，与 server 的 run.ts 保持一致，不是界面文案
const ATTACHMENT_PATTERN = /^\[附件: (.*?) \(id: ([0-9a-f]{64})\)\]\n{0,2}/;

/** `@` 引用的正文标记；标记与展开块一一对应，界面靠它还原引用在句子里的位置 */
export const contextMarker = (path: string): string => `@${path}`;

/**
 * 服务端 `wrapUntrusted` 的属性转义（`&` `<` `>` `"`）的逆运算。
 * 参数与路径都可能带这些字符，还原后才好当正文显示。
 */
const unescapeAttribute = (value: string): string =>
  value
    .replaceAll("&quot;", '"')
    .replaceAll("&gt;", ">")
    .replaceAll("&lt;", "<")
    .replaceAll("&amp;", "&");

/** 展开块上的行范围写着 `lines="3-10"`（末行缺省时是 `lines="3-"`）；缺省即整文件引用 */
const lineRangeOf = (raw: string | undefined): Pick<ContextRef, "startLine" | "endLine"> => {
  if (!raw) return {};
  const [start, end] = raw.split("-");
  const startLine = Number.parseInt(start ?? "", 10);
  const endLine = Number.parseInt(end ?? "", 10);
  return {
    ...(Number.isFinite(startLine) ? { startLine } : {}),
    ...(Number.isFinite(endLine) ? { endLine } : {}),
  };
};

/**
 * 把正文里的引用标记切成 `context` 段，只认**前置块里出现过**的引用——
 * 用户自己打的 `@张三` 不在其中，因此不会被误判成引用。
 * 最长匹配优先（`@a.ts` 与 `@a.ts.bak` 并存时不会切错）；一条引用只切一次，多出来的标记留在文本里。
 */
const splitSegments = (text: string, refs: readonly ContextRef[]): UserTextSegment[] => {
  const remaining = [...refs];
  const segments: UserTextSegment[] = [];
  let buffer = "";
  let index = 0;

  const flush = (): void => {
    if (buffer === "") return;
    segments.push({ type: "text", text: buffer });
    buffer = "";
  };

  while (index < text.length) {
    if (text[index] === "@") {
      let best: ContextRef | undefined;
      for (const ref of remaining) {
        if (!text.startsWith(contextMarker(ref.path), index)) continue;
        if (best === undefined || ref.path.length > best.path.length) best = ref;
      }
      if (best !== undefined) {
        flush();
        segments.push({ type: "context", ...best });
        remaining.splice(remaining.indexOf(best), 1);
        index += best.path.length + 1;
        continue;
      }
    }
    buffer += text[index];
    index += 1;
  }

  flush();
  return segments;
};

export const parseUserMessage = (raw: string): ParsedUserMessage => {
  let text = raw;
  let skill: SkillChip | undefined;
  let command: CommandChip | undefined;
  const contexts: ContextRef[] = [];
  const attachments: AttachmentChip[] = [];

  // 前置展开块：形状由服务端给出，逐个从头部剥离；只可能出现在最前面，剥完即止
  for (;;) {
    const skillMatch = text.match(SKILL_PATTERN);
    if (skillMatch) {
      skill = { name: skillMatch[1] ?? "" };
      text = text.slice(skillMatch[0].length);
      continue;
    }
    const commandMatch = text.match(COMMAND_PATTERN);
    if (commandMatch) {
      command = {
        name: commandMatch[1] ?? "",
        args: unescapeAttribute(commandMatch[2] ?? ""),
      };
      text = text.slice(commandMatch[0].length);
      continue;
    }
    const contextMatch = text.match(CONTEXT_PATTERN);
    if (contextMatch) {
      contexts.push({
        path: unescapeAttribute(contextMatch[1] ?? ""),
        ...lineRangeOf(contextMatch[2]),
      });
      text = text.slice(contextMatch[0].length);
      continue;
    }
    const attachmentMatch = text.match(ATTACHMENT_PATTERN);
    if (attachmentMatch) {
      attachments.push({ name: attachmentMatch[1] ?? "", id: attachmentMatch[2] ?? "" });
      text = text.slice(attachmentMatch[0].length);
      continue;
    }
    break;
  }

  return { skill, command, attachments, segments: splitSegments(text, contexts), text };
};

/**
 * 用户原文：命令与技能还原成 `/name args` / `/skill:name args`，其余照 `text`。
 * 复制与编辑回填都要「用户当初写的那句」——注入进去的技能正文与模板正文不是原话，而技能块之后的
 * 正文恰好就是 `parsed.text`（服务端展开时就是把参数接在块后的）。
 */
export const userMessageText = (parsed: ParsedUserMessage): string => {
  if (parsed.command) {
    return [`/${parsed.command.name}`, parsed.command.args].filter(Boolean).join(" ");
  }
  if (parsed.skill) {
    return [`/skill:${parsed.skill.name}`, parsed.text.trim()].filter(Boolean).join(" ");
  }
  return parsed.text;
};

/**
 * 编辑重发时要回传的引用：只带 `text` 里仍留着标记的那些——用户在编辑态删掉一条 `@` 标记，
 * 对应的展开块就不该再发给模型。行范围沿用原展开块。
 */
export const contextRefsOf = (parsed: ParsedUserMessage, text: string): ContextRef[] =>
  parsed.segments.flatMap((segment) =>
    segment.type === "context" && text.includes(contextMarker(segment.path))
      ? [
          {
            path: segment.path,
            ...(segment.startLine !== undefined ? { startLine: segment.startLine } : {}),
            ...(segment.endLine !== undefined ? { endLine: segment.endLine } : {}),
          },
        ]
      : [],
  );

/**
 * 把正文里的引用标记换成本会话工作目录下的相对写法（与服务端展开块的 `path` 属性同口径）。
 * 载荷里的标记是编辑器插入的绝对路径，逐条按已知引用精确替换，不会误伤用户自己打的 `@`；
 * 认不出工作目录（或引用不在其下）时保持原样，正文里仍是一条完整的路径。
 */
export const relativizeContextRefs = (payload: ComposerPayload, cwd?: string): ComposerPayload => {
  if (!cwd || payload.contexts.length === 0) return payload;
  const text = payload.contexts.reduce(
    (current, ref) =>
      current.replaceAll(contextMarker(ref.path), contextMarker(toRelativePath(cwd, ref.path))),
    payload.text,
  );
  return text === payload.text ? payload : { ...payload, text };
};
