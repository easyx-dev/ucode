/**
 * 会话条目 → 界面：前置展开块的剥离、正文里标记的切分、命令 / 技能 / 附件 chip 的取出。
 *
 * 服务端把注入内容拼成前置块与正文一起落进会话条目（顺序见 `server/src/services/sessions/run.ts`）：
 *   <skill …>…</skill> / <command …>…</command> / <context …>…</context> / 用户正文
 * 块内容只喂给模型，界面整体剥掉它们（不展开、不成段）：命令与技能各自出 chip 排在气泡上方，
 * 正文里的 `@` 引用、图片标记与附件引用行是句子成分，就地还原成可点 chip（位置即用户当初放的位置）。
 * 命令与技能的参数挂在展开块的 `args` 属性上，它们同样是「用户写的正文」，走同一遍扫描。
 * 块内容已由服务端的 `neutralizeTags` 转义同名标签，因此匹配首个闭合标签是安全的。
 */
import {
  ATTACHMENT_REF_PATTERN,
  ATTACHMENT_REF_PREFIX,
  COMMAND_TAG,
  CONTEXT_TAG,
  type ContextRef,
  contextMarker,
  IMAGE_MARKER_PREFIX,
  SKILL_TAG,
  scanAttachmentMarkers,
} from "@ucode/contracts";
import { toRelativePath } from "./path.ts";

/** 技能 chip：显示技能名，参数是它自己容器里的那段 */
export type SkillChip = { name: string; args: string };
/** 提示词命令：chip 显示 `/name`，参数就是用户写的那段 */
export type CommandChip = { name: string; args: string };
/** 非图片附件：正文里是展开后的引用行 `[附件: <显示名> (id: <sha256>)]` */
export type AttachmentChip = { id: string; name: string };

/**
 * 正文的一段：普通文本、一条引用标记、一个非图片附件，或一张图片（按同类型附件的出现次序定位）。
 * 附件与图片在正文里的位置是用户想表达的位置，因此界面按段落就地渲染，而不是抽出来排成一行。
 */
export type EntrySegment =
  | { type: "text"; text: string }
  | ({ type: "context" } & ContextRef)
  | ({ type: "attachment" } & AttachmentChip)
  | {
      type: "image";
      /** 本条消息里的第几张图片，1 起（与正文标记 `图片 N` 同口径）；取 image block 时减一 */
      index: number;
    };

export type ParsedEntry = {
  /** 技能调用，按注入顺序；可多条 */
  skills: SkillChip[];
  command?: CommandChip;
  /** 正文分段（标记已切出来），`text` 是它们的原始拼接 */
  segments: EntrySegment[];
  /** 用户正文：剥掉全部前置展开块，各类标记留在用户写的那句话里 */
  text: string;
};
// 标签名取自契约（服务端的包裹器用同一份名单）：名字一改两边同步，不会单边失效
const SKILL_PATTERN = new RegExp(
  `^<${SKILL_TAG} name="([^"]*)" location="[^"]*" args="([^"]*)">\\n[\\s\\S]*?\\n</${SKILL_TAG}>\\n{0,2}`,
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

/** `@` 引用的正文标记（`@路径`）；本模块多处要用，也转出去给同域模块共用同一份字面量 */
export { contextMarker };

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
const splitSegments = (text: string, refs: readonly ContextRef[]): EntrySegment[] => {
  // 逐位置匹配用 sticky 正则：只在这里建，避免共享 `lastIndex`
  const attachmentAt = new RegExp(ATTACHMENT_REF_PATTERN.source, "y");
  const remaining = [...refs];
  const segments: EntrySegment[] = [];
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

export const parseEntryText = (raw: string): ParsedEntry => {
  let text = raw;
  const skills: SkillChip[] = [];
  let command: CommandChip | undefined;
  const contexts: ContextRef[] = [];
  /** 头部剥出来的附件引用行（早期写法）：位置不在句子里，但仍是附件段 */
  const leading: EntrySegment[] = [];

  // 前置展开块：形状由服务端给出，逐个从头部剥离；只可能出现在最前面，剥完即止
  for (;;) {
    const skillMatch = text.match(SKILL_PATTERN);
    if (skillMatch) {
      skills.push({
        name: unescapeAttribute(skillMatch[1] ?? ""),
        args: unescapeAttribute(skillMatch[2] ?? ""),
      });
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

  // 命令与技能的参数都挂在展开块的 `args` 属性里（模板正文 / 技能正文把用户那段换掉了），
  // 它们同样是「用户写的正文」：与块外文本一起按同一遍标记扫描，引用与图片才还原得回来
  const body = [command?.args, ...skills.map((item) => item.args), text]
    .filter((part): part is string => Boolean(part))
    .join("\n\n");
  return {
    skills,
    command,
    segments: [...leading, ...splitSegments(body, contexts)],
    text,
  };
};

/**
 * 用户写下的正文：去掉只对模型有意义的位置标记（附件引用行、图片标记），其余照原样；
 * 复制这条消息时要的是「用户当初写的那句」，不是把 id 也拷出去。
 */
export const visibleTextOf = (segments: readonly EntrySegment[]): string =>
  segments
    .map((segment) =>
      segment.type === "text"
        ? segment.text
        : segment.type === "context"
          ? contextMarker(segment.path)
          : "",
    )
    .join("");

/** 一条命令 / 技能还原成方言容器；参数为空时只写围栏 */
const containerOf = (kind: "command" | "skill", name: string, args: string): string =>
  args ? `:::${kind}[${name}]\n${args}\n:::` : `:::${kind}[${name}]\n:::`;

/** 去掉只对模型有意义的位置标记（图片、非图片附件、附件引用行），复制出去的是用户写的那句 */
const withoutAttachmentMarkers = (text: string): string => {
  const withoutRefs = text.replaceAll(ATTACHMENT_REF_PATTERN, "");
  let result = withoutRefs;
  for (const hit of scanAttachmentMarkers(withoutRefs).reverse()) {
    result = result.slice(0, hit.from) + result.slice(hit.to);
  }
  return result;
};

/**
 * 用户原文：还原成**方言**（`:::command[name]` / `:::skill[name]` 容器 + 正文）。
 * 复制、编辑与「输入框里那份文本」是同一份——注入进去的模板正文与技能正文不是用户写的字。
 */
export const userMessageText = (parsed: ParsedEntry): string => {
  const blocks: string[] = [];
  if (parsed.command) {
    blocks.push(
      containerOf(
        "command",
        parsed.command.name,
        withoutAttachmentMarkers(parsed.command.args).trim(),
      ),
    );
  }
  for (const skill of parsed.skills) {
    blocks.push(containerOf("skill", skill.name, withoutAttachmentMarkers(skill.args).trim()));
  }
  const prose = withoutAttachmentMarkers(parsed.text).trim();
  if (prose) blocks.push(prose);
  return blocks.join("\n\n");
};

/** 引用换算要读写的字段：只要「正文 + 引用 + 命令 / 技能」，不绑定某一端的载荷定义 */
export type MarkedPayload = {
  text: string;
  contexts: ContextRef[];
  /** 附件（各项至少带 id）；是否原样透传取决于调用方，这里只保证类型对得上 */
  attachments?: readonly unknown[] | undefined;
  command?: { name: string; args: string } | undefined;
  skills?: readonly { name: string; args: string }[] | undefined;
};

/**
 * 把正文里的引用标记换成本会话工作目录下的相对写法（与服务端展开块的 `path` 属性同口径）。
 * 载荷里的标记是编辑器插入的绝对路径，逐条按已知引用精确替换，不会误伤用户自己打的 `@`；
 * 认不出工作目录（或引用不在其下）时保持原样，正文里仍是一条完整的路径。
 */
export const relativizeContextRefs = <T extends MarkedPayload>(payload: T, cwd?: string): T => {
  if (!cwd || payload.contexts.length === 0) return payload;
  const relativize = (text: string): string =>
    payload.contexts.reduce(
      (current, ref) =>
        current.replaceAll(contextMarker(ref.path), contextMarker(toRelativePath(cwd, ref.path))),
      text,
    );

  // 命令与技能的参数同样是用户正文：里面的 `@绝对路径` 也要换算，否则条目里正文与展开块的 path 对不上
  const command = payload.command
    ? { ...payload.command, args: relativize(payload.command.args) }
    : undefined;
  const skills = payload.skills?.map((skill) => ({ ...skill, args: relativize(skill.args) }));
  // 泛型保住调用方的载荷类型（载荷字段可能比这里读的三个多）
  return {
    ...payload,
    text: relativize(payload.text),
    ...(command ? { command } : {}),
    ...(skills ? { skills } : {}),
  } as T;
};
