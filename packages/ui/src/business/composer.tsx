/** 输入区：白卡容器，顶部上下文行 + Tiptap 编辑器 + 底部工具栏（模型 / 模式 / 思考 / 发送） */

import { cn } from "cn";
import { ArrowUp, FolderOpen, Square } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "../base/button";
import { useCommands } from "../hooks/use-commands";
import { BUILTIN_COMMANDS, type BuiltinCommandId } from "../lib/builtin-commands";
import { type ComposerNode, docToPayload, textToDoc } from "../lib/composer-document";
import type { ComposerPayload } from "../lib/composer-payload";
import type { AttachmentView, CatalogProvider, PermissionMode, ThinkingLevel } from "../lib/types";
import { useClient } from "../provider";
import { AttachmentStrip } from "./composer/attachment-strip";
import { ComposerEditor } from "./composer/editor";
import type { SuggestionItem } from "./composer/suggestion";
import { filesOf, useComposerAttachments } from "./composer/use-composer-attachments";
import { ModePicker } from "./mode-picker";
import { ModelPicker } from "./model-picker";
import { PermissionPicker } from "./permission-picker";
import { ThinkingPicker } from "./thinking-picker";

type ComposerProps = {
  sessionId: string | null;
  /** 展示用目录标签（助理区可能被替换成文案） */
  cwd?: string;
  /** 真实工作目录，`@` 检索用它 */
  cwdPath?: string;
  /** 草稿里恢复的初始文档 */
  initialDoc?: ComposerNode;
  /** 草稿里恢复的附件视图 */
  initialAttachments?: readonly AttachmentView[];
  /** 编辑器重挂载键：上下文 + 外部填充版本 */
  editorKey: string;
  onDocChange: (doc: ComposerNode) => void;
  /** 附件集合变化（增删）时回写草稿 */
  onAttachmentsChange: (attachments: AttachmentView[]) => void;
  onSend: (payload: ComposerPayload) => void;
  onStop: () => void;
  streaming: boolean;
  suggestions?: readonly string[];
  providers: CatalogProvider[];
  model: string;
  thinkingLevel: ThinkingLevel;
  mode: string;
  permissionMode: PermissionMode;
  onSelectModel: (model: string) => void;
  onSelectThinkingLevel: (level: ThinkingLevel) => void;
  onSelectMode: (mode: string) => void;
  onSelectPermissionMode: (mode: PermissionMode) => void;
  /** 内置动作（不落正文，由上层执行） */
  onBuiltin: (id: BuiltinCommandId) => void;
};

const MAX_CONTEXT_ITEMS = 20;

/** 空文档常量：多处重置编辑器共用，保持引用稳定 */
const EMPTY_DOC: ComposerNode = { type: "doc", content: [{ type: "paragraph" }] };

/** 整条输入就是一个内置命令名（如 `/new`）时取其 id；带参数或不匹配返回 null */
const builtinIdOf = (text: string): BuiltinCommandId | null => {
  const match = /^\/([a-z][a-z0-9-]*)\s*$/.exec(text.trim());
  if (!match) return null;
  return BUILTIN_COMMANDS.find((command) => command.name === match[1])?.id ?? null;
};

export function Composer({
  sessionId,
  cwd,
  cwdPath,
  initialDoc,
  initialAttachments,
  editorKey,
  onDocChange,
  onAttachmentsChange,
  onSend,
  onStop,
  streaming,
  suggestions,
  providers,
  model,
  thinkingLevel,
  mode,
  permissionMode,
  onSelectModel,
  onSelectThinkingLevel,
  onSelectMode,
  onSelectPermissionMode,
  onBuiltin,
}: ComposerProps) {
  const { t } = useTranslation();
  const client = useClient();
  const commands = useCommands(sessionId, cwdPath);
  const {
    items: attachmentItems,
    error: attachmentError,
    uploading,
    hasPendingUploads,
    addFiles,
    remove: removeAttachment,
  } = useComposerAttachments({
    initialAttachments: initialAttachments ?? [],
    onChange: onAttachmentsChange,
  });

  const docRef = useRef<ComposerNode>(initialDoc ?? EMPTY_DOC);
  /**
   * 外部填充（发送后清空 / 失败回填 / 建议 chips）：改初始文档并让编辑器重挂载。
   * 记下写入时的 `editorKey`——切换会话时不把上一个会话的文档喂给新挂载的编辑器。
   */
  const [externalDoc, setExternalDoc] = useState<{ key: string; doc: ComposerNode } | null>(
    initialDoc ? { key: editorKey, doc: initialDoc } : null,
  );
  const versionRef = useRef(0);
  const [version, setVersion] = useState(0);
  /** `/models`、`/thinking`、`/mode`、`/permission` 从命令唤起的选择器（复用工具栏里的同一个弹出层） */
  const [openPicker, setOpenPicker] = useState<"model" | "thinking" | "mode" | "permission" | null>(
    null,
  );
  /**
   * 编辑器最后一次拿到的文档（JSON 快照）。Tiptap 不受控，只有重挂载才会换内容；
   * 用它区分「外部草稿变化」（清空 / 回填）与「自己刚写出去的那份」，避免每次按键都重挂载。
   */
  const syncedRef = useRef(JSON.stringify(initialDoc ?? EMPTY_DOC));

  /** 把编辑器切到给定文档：重挂载并记下已同步内容 */
  const resetEditor = useCallback(
    (doc: ComposerNode) => {
      syncedRef.current = JSON.stringify(doc);
      docRef.current = doc;
      setExternalDoc({ key: editorKey, doc });
      versionRef.current += 1;
      setVersion(versionRef.current);
    },
    [editorKey],
  );

  const handleDocChange = useCallback(
    (doc: ComposerNode) => {
      docRef.current = doc;
      syncedRef.current = JSON.stringify(doc);
      onDocChange(doc);
    },
    [onDocChange],
  );

  // 草稿被外部改动（发送后清空、失败回填）时同步进编辑器
  useEffect(() => {
    const next = initialDoc ?? EMPTY_DOC;
    if (JSON.stringify(next) === syncedRef.current) return;
    resetEditor(next);
  }, [initialDoc, resetEditor]);

  /**
   * 内置命令分发：切换模型 / 思考档位 / 模式 / 权限档位这四个直接打开工具栏里的选择器（就地完成），
   * 其余交给上层（会话级动作在 App）。无可用模型时 `/models` 只提示，不空开弹出层。
   */
  const handleBuiltin = useCallback(
    (id: BuiltinCommandId) => {
      if (id === "models") {
        if (providers.length === 0) {
          toast.info(t("请先接入模型供应商"));
          return;
        }
        setOpenPicker("model");
        return;
      }
      if (id === "thinking") {
        setOpenPicker("thinking");
        return;
      }
      if (id === "mode") {
        setOpenPicker("mode");
        return;
      }
      if (id === "permission") {
        setOpenPicker("permission");
        return;
      }
      onBuiltin(id);
    },
    [onBuiltin, providers.length, t],
  );

  const submit = useCallback(() => {
    // 附件还在上传时不发：否则会把没背上的附件漏掉，上传完成后又回填进草稿
    if (streaming || hasPendingUploads()) return;
    const doc = docToPayload(docRef.current);
    const attachments = attachmentItems;
    if (doc.text.trim() === "" && doc.contexts.length === 0 && attachments.length === 0) {
      return;
    }
    // 手动输入的整条内置命令（如 `/new`）：直接执行，不当作消息发出去
    if (doc.contexts.length === 0 && attachments.length === 0) {
      const builtin = builtinIdOf(doc.text);
      if (builtin) {
        resetEditor(EMPTY_DOC);
        handleBuiltin(builtin);
        return;
      }
    }
    onSend({ ...doc, attachments });
  }, [attachmentItems, handleBuiltin, hasPendingUploads, onSend, resetEditor, streaming]);

  const handleFiles = useCallback(
    (files: File[]) => {
      void addFiles(files);
    },
    [addFiles],
  );

  const fill = (text: string): void => {
    const doc = textToDoc(text);
    resetEditor(doc);
    handleDocChange(doc);
  };

  const commandItems = useCallback(
    (query: string): SuggestionItem[] => {
      const needle = query.trim().toLowerCase();
      const match = (value: string): boolean =>
        needle === "" || value.toLowerCase().includes(needle);
      // 草稿态（无会话）不列需要会话才能执行的命令，避免选了没反应
      const builtin: SuggestionItem[] = BUILTIN_COMMANDS.filter(
        (command) => (sessionId !== null || !command.needsSession) && match(command.name),
      ).map((command) => ({
        id: `builtin:${command.id}`,
        label: `/${command.name}`,
        hint: (t as (key: string) => string)(command.descriptionKey),
        group: t("内置动作"),
        builtin: command.id,
      }));
      const prompts: SuggestionItem[] = commands.prompts
        .filter((item) => match(item.name))
        .map((item) => ({
          id: `prompt:${item.name}`,
          label: `/${item.name}`,
          hint: item.description,
          group: t("命令"),
          kind: "prompt",
          name: item.name,
        }));
      const skills: SuggestionItem[] = commands.skills
        .filter((item) => match(item.name))
        .map((item) => ({
          id: `skill:${item.name}`,
          label: `/skill:${item.name}`,
          hint: item.description,
          group: t("技能"),
          kind: "skill",
          name: item.name,
        }));
      return [...builtin, ...prompts, ...skills];
    },
    [commands.prompts, commands.skills, sessionId, t],
  );

  const contextItems = useCallback(
    async (query: string): Promise<SuggestionItem[]> => {
      if (!cwdPath) return [];
      try {
        const result = await client.apis.fs.search({
          path: cwdPath,
          q: query,
          limit: MAX_CONTEXT_ITEMS,
        });
        return result.entries.map((entry) => ({
          id: entry.path,
          label: entry.type === "directory" ? `${entry.name}/` : entry.name,
          hint: entry.path,
          group: t("文件"),
          path: entry.path,
        }));
      } catch {
        return [];
      }
    },
    [client, cwdPath, t],
  );

  return (
    <div className="border-t border-border bg-card px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      <div className="mx-auto w-full max-w-3xl space-y-2">
        {suggestions && suggestions.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {suggestions.map((text) => (
              <button
                key={text}
                type="button"
                onClick={() => fill(text)}
                className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                {text}
              </button>
            ))}
          </div>
        ) : null}

        {/* biome-ignore lint/a11y/noStaticElementInteractions: 卡片仅作粘贴 / 拖拽落点，真正的交互在内部编辑器 */}
        <div
          className={cn(
            "rounded-xl bg-popover ring-1 ring-foreground/10 transition-shadow",
            "focus-within:ring-2 focus-within:ring-ring/40",
          )}
          onPaste={(event) => {
            // 编辑器内的粘贴会先被它拦截（defaultPrevented），这里兜住其余区域的粘贴
            if (event.defaultPrevented) return;
            const files = filesOf(event.clipboardData);
            if (files.length === 0) return;
            event.preventDefault();
            handleFiles(files);
          }}
          onDragOver={(event) => {
            if (event.dataTransfer?.types.includes("Files")) event.preventDefault();
          }}
          onDrop={(event) => {
            // 编辑器内的拖放已由 handleDrop 处理并 preventDefault，避免重复入库
            if (event.defaultPrevented) return;
            const files = filesOf(event.dataTransfer);
            if (files.length === 0) return;
            event.preventDefault();
            handleFiles(files);
          }}
        >
          {cwd ? (
            <div className="flex items-center gap-1.5 px-3 pt-2.5 text-xs text-muted-foreground">
              <FolderOpen className="size-3.5 shrink-0" />
              <span className="truncate">{cwd}</span>
            </div>
          ) : null}

          <AttachmentStrip attachments={attachmentItems} onRemove={removeAttachment} />

          {attachmentError ? (
            <p className="px-3 pt-2 text-xs text-destructive">
              {t("附件过大：{{names}}", { names: attachmentError })}
            </p>
          ) : null}

          <ComposerEditor
            key={`${editorKey}:${version}`}
            initialDoc={externalDoc && externalDoc.key === editorKey ? externalDoc.doc : initialDoc}
            placeholder={t("输入消息，Enter 发送，Shift+Enter 换行")}
            onChange={handleDocChange}
            onSend={submit}
            contextItems={contextItems}
            commandItems={commandItems}
            onBuiltin={(id) => handleBuiltin(id as BuiltinCommandId)}
            onFiles={handleFiles}
          />

          <div className="flex items-center gap-1 px-2 pb-2">
            {providers.length > 0 ? (
              <ModelPicker
                providers={providers}
                value={model}
                open={openPicker === "model"}
                onOpenChange={(next) => setOpenPicker(next ? "model" : null)}
                onSelect={onSelectModel}
              />
            ) : null}

            <ModePicker
              value={mode}
              open={openPicker === "mode"}
              onOpenChange={(next) => setOpenPicker(next ? "mode" : null)}
              onSelect={onSelectMode}
            />

            <PermissionPicker
              value={permissionMode}
              disabled={sessionId === null}
              open={openPicker === "permission"}
              onOpenChange={(next) => setOpenPicker(next ? "permission" : null)}
              onSelect={onSelectPermissionMode}
            />

            <div className="ml-auto flex items-center gap-1">
              <ThinkingPicker
                value={thinkingLevel}
                open={openPicker === "thinking"}
                onOpenChange={(next) => setOpenPicker(next ? "thinking" : null)}
                onSelect={onSelectThinkingLevel}
              />

              {streaming ? (
                <Button size="icon" variant="outline" onClick={onStop} title={t("停止生成")}>
                  <Square className="size-3.5" />
                </Button>
              ) : (
                <Button size="icon" onClick={submit} disabled={uploading} title={t("发送")}>
                  <ArrowUp className="size-4" />
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
