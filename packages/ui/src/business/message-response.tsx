/**
 * 消息正文的 markdown 入口：对话正文、md 文件预览、压缩摘要共用这一条链。
 *
 * 解析与块级缓存交给 streamdown（它专门处理流式未闭合的 markdown），这里只补本仓库特有的几件事：
 * 代码块走自研 shiki 并带复制、mermaid 代码块交给图块组件、表格去掉它的外层卡片、
 * 图片与图块、表格一样可以全屏查看。插件与组件映射都是模块级常量，避免流式过程中重建导致块缓存失效。
 */
import { cjk } from "@streamdown/cjk";
import { type ComponentProps, createContext, useContext } from "react";
import { type Components, type ExtraProps, Streamdown } from "streamdown";
import { AttachmentImage } from "./attachment-image";
import { CodeBlock } from "./code-block";
import { MarkdownTable } from "./markdown-table";
import { MermaidBlock } from "./mermaid-block";

/** 消息是否仍在流式：决定 markdown 的解析模式，并让图块与代码块先出源码 */
const LiveContext = createContext(false);

/** `language-ts` → `ts`；没有语言标注时不高亮 */
const LANGUAGE_PATTERN = /language-([\w-]+)/;

const isMermaidLanguage = (language: string | null): boolean =>
  language === "mermaid" || language === "mmd";

/**
 * streamdown 按标签名向渲染器传原生属性，props 形状必须与它的 `Components` 契约一致；
 * `data-block` 是它给块级代码打上的标记（不在类型里），行内代码没有，按它分流。
 */
type MarkdownCodeProps = ComponentProps<"code"> & ExtraProps;

type MarkdownImageProps = ComponentProps<"img"> & ExtraProps;

function MarkdownCode({ className, children, ...rest }: MarkdownCodeProps) {
  const live = useContext(LiveContext);
  if (!("data-block" in rest)) return <code className={className}>{children}</code>;

  const code = String(children ?? "").replace(/\n$/, "");
  const language =
    typeof className === "string" ? (LANGUAGE_PATTERN.exec(className)?.[1] ?? null) : null;
  if (isMermaidLanguage(language)) return <MermaidBlock code={code} deferred={live} />;
  return <CodeBlock code={code} deferred={live} language={language} />;
}

/** 正文里的图片：本站附件先取字节走 blob，外链原样使用 */
function MarkdownImage({ src, alt }: MarkdownImageProps) {
  return <AttachmentImage alt={alt} url={src ?? ""} />;
}

const COMPONENTS: Components = {
  code: MarkdownCode,
  img: MarkdownImage,
  table: MarkdownTable,
};

/** 中文标点与断行按 CJK 规则处理，避免 `**加粗**。` 这类标点处被断行 */
const PLUGINS = { cjk };

const STREAMDOWN_OPTIONS = {
  // 表格复制 / 导出、图与代码块的悬浮控件都关掉：这套界面里它们要么与设计系统不一致，要么由自研组件承担
  controls: false,
  // 外链直接跳转，不改用 streamdown 的二次确认弹窗——现有交互里链接就是普通链接
  linkSafety: { enabled: false },
} as const;

export function MessageResponse({ text, live = false }: { text: string; live?: boolean }) {
  return (
    <LiveContext.Provider value={live}>
      <Streamdown
        mode={live ? "streaming" : "static"}
        plugins={PLUGINS}
        components={COMPONENTS}
        {...STREAMDOWN_OPTIONS}
      >
        {text}
      </Streamdown>
    </LiveContext.Provider>
  );
}
