/**
 * 用户消息的还原：前置展开块的剥离、正文里标记的切分、技能 / 命令 / 附件 chip 的取出。
 *
 * 服务端把注入内容拼成前置块与正文一起落进会话条目（顺序见 `server/src/services/sessions/run.ts`）：
 *   <skill …>…</skill> / <command …>…</command> / <context …>…</context> / 用户正文
 * 块内容只喂给模型，界面整体剥掉它们（不展开、不成段）：技能与命令各自出 chip 排在气泡上方，
 * 正文里的 `@` 引用、图片标记与附件引用行是句子成分，就地还原成可点 chip（位置即用户当初放的位置）。
 * 块内容已由服务端的 `neutralizeTags` 转义同名标签，因此匹配首个闭合标签是安全的。
 *
 * 解析是「段落化」的：一次扫完所有前置块，再用同一遍扫描把正文里的标记切出来。
 */
import {
  ATTACHMENT_REF_PATTERN,
  ATTACHMENT_REF_PREFIX,
  COMMAND_TAG,
  CONTEXT_TAG,
  type ContextRef,
  IMAGE_MARKER_PREFIX,
  SKILL_TAG,
} from "@ucode/contracts";

import type { ComposerPayload } from "./composer-payload";
import { toRelativePath } from "./path";

export type SkillChip = { name: string };
/** 提示词命令：chip 显示 `/name`，用户写的参数跟在正文里 */
export type CommandChip = { name: string; args: string };
/** 非图片附件：正文里是展开后的引用行 `[附件: <显示名> (id: <sha256>)]` */
export type AttachmentChip = { id: string; name: string };

/**
 * 正文的一段：普通文本、一条引用标记、一个非图片附件，或一张图片（按同类型附件的出现次序定位）。
 * 附件与图片在正文里的位置是用户想表达的位置，因此界面按段落就地渲染，而不是抽出来排成一行。
 */
export type UserTextSegment =
  | { type: "text"; text: string }
  | ({ type: "context" } & ContextRef)
  | ({ type: "attachment" } & AttachmentChip)
  | {
      type: "image";
      /** 本条消息里的第几张图片，1 起（与正文标记 `图片 N` 同口径）；取 image block 时减一 */
      index: number;
    };

export type ParsedUserMessage = {
  skill?: SkillChip;
  command?: CommandChip;
  /** 正文分段（标记已切出来），`text` 是它们的原始拼接 */
  segments: UserTextSegment[];
  /** 用户正文：剥掉全部前置展开块，各类标记留在用户写的那句话里 */
  text: string;
};

// 标签名取自契约（服务端的包裹器用同一份名单）：名字一改两边同步，不会单边失效
const SKILL_PATTERN = new RegExp(
  `^<${SKILL_TAG} name="([^"]*)" location="[^"]*">\\n[\\s\\S]*?\\n</${SKILL_TAG}>\\n{0,2}`,
);
const COMMAND_PATTERN = new RegExp(
  `^<${COMMAND_TAG} name="([^"]*)" args="([^"]*)">\\n[\\s\\S]*?\\n</${COMMAND_TAG}>\\n{0,2}`,
);
const CONTEXT_PATTERN = new RegExp(
  `^<${CONTEXT_TAG} path="([^"]*)"(?: lines="([^"]*)")?>\\n[\\s\\S]*?\\n</${CONTEXT_TAG}>\\n{0,2}`,
);
/** 图片标记里的序号：前缀之后紧跟着的数字 */
const IMAGE_ORDINAL = /^\d+/;
/** 早期消息把附件引用行前置在正文头部：连同其后的换行一起剥，免得气泡里多出空行 */
const HEAD_ATTACHMENT_PATTERN = new RegExp(`^${ATTACHMENT_REF_PATTERN.source}\\n{0,2}`);

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
 * 把正文切成文本 / 引用 / 附件 / 图片四类分段，三类标记都就地切出：
 *
 * - `@` 引用只认**前置块里出现过**的那些——用户自己打的 `@张三` 不在其中；最长匹配优先，一条只切一次。
 * - 附件引用行与图片标记的形状由服务端与编辑器保证，认到就是位置标记。
 *
 * 图片标记只切出序号，图片本体（id）由调用方按 `index` 去 image blocks 里取。
 */
const splitSegments = (text: string, refs: readonly ContextRef[]): UserTextSegment[] => {
  // 逐位置匹配用 sticky 正则：只在这里建，避免共享 `lastIndex`
  const attachmentAt = new RegExp(ATTACHMENT_REF_PATTERN.source, "y");
  const remaining = [...refs];
  const segments: UserTextSegment[] = [];
  /** 当前文本段的起点；命中标记时把 [cursor, index) 推成一段 */
  let cursor = 0;
  let index = 0;

  const flush = (end: number): void => {
    if (end > cursor) segments.push({ type: "text", text: text.slice(cursor, end) });
  };

  while (index < text.length) {
    if (text[index] === "@") {
      let best: ContextRef | undefined;
      for (const ref of remaining) {
        if (!text.startsWith(contextMarker(ref.path), index)) continue;
        if (best === undefined || ref.path.length > best.path.length) best = ref;
      }
      if (best !== undefined) {
        flush(index);
        segments.push({ type: "context", ...best });
        remaining.splice(remaining.indexOf(best), 1);
        index += best.path.length + 1;
        cursor = index;
        continue;
      }
    }
    if (text.startsWith(ATTACHMENT_REF_PREFIX, index)) {
      attachmentAt.lastIndex = index;
      const match = attachmentAt.exec(text);
      if (match) {
        flush(index);
        segments.push({ type: "attachment", name: match[1] ?? "", id: match[2] ?? "" });
        index = attachmentAt.lastIndex;
        cursor = index;
        continue;
      }
    }
    if (text.startsWith(IMAGE_MARKER_PREFIX, index)) {
      const start = index + IMAGE_MARKER_PREFIX.length;
      const digits = IMAGE_ORDINAL.exec(text.slice(start));
      const count = digits ? Number.parseInt(digits[0], 10) : 0;
      if (count > 0) {
        flush(index);
        segments.push({ type: "image", index: count });
        index = start + (digits?.[0].length ?? 0);
        cursor = index;
        continue;
      }
    }
    index += 1;
  }

  flush(text.length);
  return segments;
};

export const parseUserMessage = (raw: string): ParsedUserMessage => {
  let text = raw;
  let skill: SkillChip | undefined;
  let command: CommandChip | undefined;
  const contexts: ContextRef[] = [];
  /** 头部剥出来的附件引用行（早期写法）：位置不在句子里，但仍是附件段 */
  const leading: UserTextSegment[] = [];

  // 前置展开块：形状由服务端给出，逐个从头部剥离；只可能出现在最前面，剥完即止
  for (;;) {
    const skillMatch = text.match(SKILL_PATTERN);
    if (skillMatch) {
      skill = { name: unescapeAttribute(skillMatch[1] ?? "") };
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
    const attachmentMatch = text.match(HEAD_ATTACHMENT_PATTERN);
    if (attachmentMatch) {
      leading.push({
        type: "attachment",
        name: attachmentMatch[1] ?? "",
        id: attachmentMatch[2] ?? "",
      });
      text = text.slice(attachmentMatch[0].length);
      continue;
    }
    break;
  }

  return {
    skill,
    command,
    segments: [...leading, ...splitSegments(text, contexts)],
    text,
  };
};

/**
 * 用户写下的正文：去掉只对模型有意义的位置标记（附件引用行、图片标记），其余照原样；
 * 复制这条消息时要的是「用户当初写的那句」，不是把 id 也拷出去。
 */
export const visibleTextOf = (segments: readonly UserTextSegment[]): string =>
  segments
    .map((segment) =>
      segment.type === "text"
        ? segment.text
        : segment.type === "context"
          ? contextMarker(segment.path)
          : "",
    )
    .join("");

/**
 * 用户原文：命令与技能还原成 `/name args` / `/skill:name args`，其余照正文（去掉位置标记）。
 * 复制与编辑回填都要「用户当初写的那句」——注入进去的技能正文与模板正文不是原话，而技能块之后的
 * 正文恰好就是 `parsed.segments`（服务端展开时就是把参数接在块后的）。
 */
export const userMessageText = (parsed: ParsedUserMessage): string => {
  if (parsed.command) {
    return [`/${parsed.command.name}`, parsed.command.args].filter(Boolean).join(" ");
  }
  if (parsed.skill) {
    return [`/skill:${parsed.skill.name}`, visibleTextOf(parsed.segments).trim()]
      .filter(Boolean)
      .join(" ");
  }
  return visibleTextOf(parsed.segments);
};

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
