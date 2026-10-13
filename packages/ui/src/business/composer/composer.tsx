/** 输入区：白卡容器，顶部上下文行 + Tiptap 编辑器 + 底部工具栏（添加 · 模式 · 权限 · 模型 · 思考 · 发送） */

import { brand } from "@ucode/brand";
import { cn } from "cn";
import { ArrowUp, Square } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "../../base/button";
import type {
  CatalogProvider,
  PermissionMode,
  ThinkingLevel,
  ThinkingPreference,
} from "../../types";
import { AddMenu } from "./add-menu";
import { BUILTIN_COMMANDS, type BuiltinCommandId, builtinCommandIdOf } from "./builtin-commands";
import {
  type ComposerNode,
  docToPayload,
  isDocEmpty,
  textToDoc,
} from "./document/composer-document";
import type { ComposerPayload } from "./document/composer-payload";
import { useContextItems } from "./editor/context-items";
import { ComposerEditor, type ComposerEditorHandle } from "./editor/editor";
import type { SuggestionItem } from "./editor/suggestion";
import { ComposerSuggestions } from "./editor/suggestions";
import { filesOf, useComposerAttachments } from "./editor/use-composer-attachments";
import { ModePicker } from "./picker/mode-picker";
import { ModelPicker } from "./picker/model-picker";
import { PermissionPicker } from "./picker/permission-picker";
import { ThinkingPicker } from "./picker/thinking-picker";
import { ProjectRow } from "./project/project-row";
import { useCommands } from "./use-commands";

type ComposerProps = {
  sessionId: string | null;
  /** 真实工作目录：`@` 检索、技能清单与分支 chip 都用它 */
  cwdPath?: string;
  /** 草稿里恢复的初始文档（附件与引用都在文档的节点里） */
  initialDoc?: ComposerNode;
  /** 编辑器重挂载键：上下文 + 外部填充版本 */
  editorKey: string;
  onDocChange: (doc: ComposerNode) => void;
  /** 发送：带上当时那份文档，投递被拒时外层用它原样填回输入框 */
  onSend: (payload: ComposerPayload, doc: ComposerNode) => void;
  onStop: () => void;
  streaming: boolean;
  /** 空态（还没有消息）：占位符与卡下建议行只在这个状态下出现 */
  showSuggestions?: boolean;
  /** 项目展示名；助理区会话显示成文案 */
  projectName: string;
  /** 草稿态选中的项目路径；小助理为 null */
  projectPath: string | null;
  onSelectProject: (path: string | null) => void;
  providers: CatalogProvider[];
  model: string;
  thinkingLevel: ThinkingPreference;
  /** 实际生效的档位：`thinkingLevel` 为 `auto` 时展示成「自动 · 极高」 */
  resolvedThinkingLevel?: ThinkingLevel;
  mode: string;
  permissionMode: PermissionMode;
  onSelectModel: (model: string) => void;
  onSelectThinkingLevel: (level: ThinkingPreference) => void;
  onSelectMode: (mode: string) => void;
  onSelectPermissionMode: (mode: PermissionMode) => void;
  /** 内置动作（不落正文，由上层执行） */
  onBuiltin: (id: BuiltinCommandId) => void;
};

/** 空文档常量：多处重置编辑器共用，保持引用稳定 */
const EMPTY_DOC: ComposerNode = { type: "doc", content: [{ type: "paragraph" }] };

export function Composer({
  sessionId,
  cwdPath,
  initialDoc,
  editorKey,
  onDocChange,
  onSend,
  onStop,
  streaming,
  showSuggestions,
  projectName,
  projectPath,
  onSelectProject,
  providers,
  model,
  thinkingLevel,
  resolvedThinkingLevel,
  mode,
  permissionMode,
  onSelectModel,
  onSelectThinkingLevel,
  onSelectMode,
  onSelectPermissionMode,
  onBuiltin,
}: ComposerProps) {
  const { t } = useTranslation();
  const commands = useCommands(sessionId, cwdPath);
  const contextItems = useContextItems(cwdPath);
  /** 焦点收回输入区的入口：发送之后、选择器关掉之后 */
  const editorHandle = useRef<ComposerEditorHandle | null>(null);
  const {
    error: attachmentError,
    uploading,
    hasPendingUploads,
    addFiles,
  } = useComposerAttachments({ editor: editorHandle });

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

  /**
   * 工具栏的五个弹层关掉后都把焦点交回输入区（各选择器用 `usePickerCloseFocus` 在真正关闭的那一刻调它）：
   * 点选、`Esc`、`/` 命令拉起三条路径同一种结果；点在别处（消息、别的按钮）时它们不调，
   * 那种情况下焦点归用户点的那个东西。
   */
  const focusEditor = useCallback(() => editorHandle.current?.focus(), []);

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
    // 附件还在上传时不发：否则会把还没拿到 id 的占位漏掉，上传完成后又留在草稿里
    if (streaming || hasPendingUploads()) return;
    const doc = docRef.current;
    if (isDocEmpty(doc)) return;
    const payload = docToPayload(doc);
    // 手动输入的整条内置命令（如 `/new`）：直接执行，不当作消息发出去
    if (payload.contexts.length === 0 && payload.attachments.length === 0) {
      const builtin = builtinCommandIdOf(payload.text);
      if (builtin) {
        resetEditor(EMPTY_DOC);
        handleBuiltin(builtin);
        focusEditor();
        return;
      }
    }
    onSend(payload, doc);
    focusEditor();
  }, [focusEditor, handleBuiltin, hasPendingUploads, onSend, resetEditor, streaming]);

  const handleFiles = useCallback(
    (files: File[]) => {
      addFiles(files);
    },
    [addFiles],
  );

  // 「+」菜单的附件走系统文件对话框：对话框关掉后浏览器不会把焦点还给输入区，这里补一次
  const handleMenuFiles = useCallback(
    (files: File[]) => {
      handleFiles(files);
      focusEditor();
    },
    [focusEditor, handleFiles],
  );

  const handleStop = useCallback(() => {
    onStop();
    focusEditor();
  }, [focusEditor, onStop]);

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
      const translate = t as (key: string) => string;
      // 草稿态（无会话）不列需要会话才能执行的命令，避免选了没反应
      const builtin: SuggestionItem[] = BUILTIN_COMMANDS.filter(
        (command) => (sessionId !== null || !command.needsSession) && match(command.name),
      ).map((command) => ({
        id: `builtin:${command.id}`,
        label: `/${command.name}`,
        hint: [translate(command.descriptionKey), command.argumentHint].filter(Boolean).join(" · "),
        group: t("内置动作"),
        builtin: command.id,
        takesArgument: command.takesArgument === true,
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

  return (
    <div className="px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      {/* 新会话（还没落会话，即「未选择会话」草稿态）收窄一档：此时输入卡与问候语自成一块，与消息列无关 */}
      <div
        className={cn("mx-auto w-full space-y-2", sessionId === null ? "max-w-2xl" : "max-w-4xl")}
      >
        {/* biome-ignore lint/a11y/noStaticElementInteractions: 整条容器都作粘贴 / 拖拽落点，真正的交互在内部编辑器 */}
        <div
          // 灰底只在草稿态铺：它是首行项目 / 分支条的底，已有会话没这一行，白卡直接落在面板上
          className={cn(sessionId === null && "rounded-xl bg-muted/50")}
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
          {sessionId === null ? (
            <ProjectRow
              cwdPath={cwdPath}
              projectName={projectName}
              projectPath={projectPath}
              onSelectProject={onSelectProject}
            />
          ) : null}

          <div
            className={cn(
              "rounded-lg bg-popover ring-1 ring-border-strong transition-shadow",
              // 聚焦只换 ring 颜色：变宽会让输入卡在光标进出时抖一下
              "focus-within:ring-ring",
            )}
          >
            {attachmentError ? (
              <p className="px-3 pt-2 text-xs text-destructive">
                {t("无法添加附件：{{names}}", { names: attachmentError })}
              </p>
            ) : null}

            <ComposerEditor
              ref={editorHandle}
              key={`${editorKey}:${version}`}
              initialDoc={
                externalDoc && externalDoc.key === editorKey ? externalDoc.doc : initialDoc
              }
              placeholder={
                showSuggestions
                  ? t("向 {{name}} 提问，使用 @ 添加上下文，使用 / 选择命令或能力", {
                      name: brand.name,
                    })
                  : t("提出后续修改要求")
              }
              onChange={handleDocChange}
              onSend={submit}
              contextItems={contextItems}
              commandItems={commandItems}
              onBuiltin={(id) => handleBuiltin(id as BuiltinCommandId)}
              onFiles={handleFiles}
            />

            {/*
              左：添加 · 模式 · 权限；右：模型 · 思考 · 发送。
              整行不换行也不横向滚动：容器窄于阈值时四个选择器只留图标（`@container` 供
              PICKER_TRIGGER_LABEL_CLASS 的容器查询用），模型名按剩余宽度截断。
              五个弹层关掉后都把焦点交回输入区（`onRefocus`），见 `focusEditor`。
            */}
            <div className="@container flex items-center gap-1 px-2 pb-2">
              <div className="flex min-w-0 items-center gap-1 whitespace-nowrap">
                <AddMenu
                  sessionId={sessionId}
                  cwdPath={cwdPath}
                  onFiles={handleMenuFiles}
                  onInsertCommand={(command) =>
                    editorHandle.current?.insertCommand(command) ?? false
                  }
                  onRefocus={focusEditor}
                />

                <ModePicker
                  value={mode}
                  open={openPicker === "mode"}
                  onOpenChange={(next) => setOpenPicker(next ? "mode" : null)}
                  onSelect={onSelectMode}
                  onRefocus={focusEditor}
                />

                <PermissionPicker
                  value={permissionMode}
                  open={openPicker === "permission"}
                  onOpenChange={(next) => setOpenPicker(next ? "permission" : null)}
                  onSelect={onSelectPermissionMode}
                  onRefocus={focusEditor}
                />
              </div>

              <div className="ml-auto flex min-w-0 items-center gap-1 whitespace-nowrap">
                {providers.length > 0 ? (
                  <ModelPicker
                    providers={providers}
                    value={model}
                    open={openPicker === "model"}
                    onOpenChange={(next) => setOpenPicker(next ? "model" : null)}
                    onSelect={onSelectModel}
                    onRefocus={focusEditor}
                  />
                ) : null}

                <ThinkingPicker
                  value={thinkingLevel}
                  resolved={resolvedThinkingLevel}
                  open={openPicker === "thinking"}
                  onOpenChange={(next) => setOpenPicker(next ? "thinking" : null)}
                  onSelect={onSelectThinkingLevel}
                  onRefocus={focusEditor}
                />

                {streaming ? (
                  <Button size="icon" variant="outline" onClick={handleStop} title={t("停止生成")}>
                    <Square className="size-icon-sm" />
                  </Button>
                ) : (
                  <Button size="icon" onClick={submit} disabled={uploading} title={t("发送")}>
                    <ArrowUp className="size-icon-base" />
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
        {showSuggestions ? <ComposerSuggestions onSelect={fill} /> : null}
      </div>
    </div>
  );
}
