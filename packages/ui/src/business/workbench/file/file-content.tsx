/**
 * 单文件内容区：顶部工具条（预览 / 源码、文件大小）+ 渲染器。
 *
 * 内容形态以 `fs/read` 的判定为准：服务端说二进制而该类型没有二进制渲染器时落到占位。
 * 渲染模式按标签本地保存（`key` 换文件即重挂载）：markdown 与 SVG 有两种形态（文档 / 图片 vs 原文 / 源码），
 * 其余只有源码一种，因此工具条上的切换只在它们身上出现——不做无意义的假开关。
 */
import type { FsReadResponse } from "@ucode/contracts";
import { Braces, Eye, FileWarning, ImageOff, RotateCw } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { IconButton } from "../../../base/button";
import { Empty } from "../../../base/empty";
import { SegmentedControl, type SegmentedOption } from "../../../base/segmented-control";
import { Spinner } from "../../../base/spinner";
import { baseName } from "../../../utils/path";
import { formatBytes, imageMimeOf, isTextImage, previewKindOf } from "../../../utils/preview";
import { DesignCanvas } from "../design/design-canvas";
import { useFileContent } from "../use-workbench-data";
import { MarkdownPreview } from "./markdown-preview";
import { TextPreview } from "./text-preview";

type RenderMode = "preview" | "source";

/** 有两种形态的：markdown（文档 / 原文）、SVG（图片 / 源码）与设计稿（画布 / 源码） */
const supportsRenderModes = (path: string): boolean => {
  const kind = previewKindOf(path);
  return kind === "markdown" || kind === "design" || isTextImage(path);
};

/** 顶部工具条：左侧渲染模式切换、右侧文件大小 */
function Toolbar({
  path,
  size,
  mode,
  onModeChange,
  onReload,
  reloading,
}: {
  path: string;
  size: number;
  mode: RenderMode;
  onModeChange: (mode: RenderMode) => void;
  onReload: () => void;
  reloading: boolean;
}) {
  const { t } = useTranslation();
  const options: Array<SegmentedOption<RenderMode>> = [
    { value: "preview", label: t("预览"), icon: <Eye className="size-icon-sm" /> },
    { value: "source", label: t("源码"), icon: <Braces className="size-icon-sm" /> },
  ];

  return (
    <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-2">
      {supportsRenderModes(path) ? (
        <SegmentedControl
          label={t("展示方式")}
          value={mode}
          options={options}
          onChange={onModeChange}
        />
      ) : null}
      <div className="ml-auto flex items-center gap-3 text-xs text-foreground-subtle">
        <span className="tabular-nums">{formatBytes(size)}</span>
        <IconButton
          disabled={reloading}
          label={t("重新读取文件")}
          size="icon-xs"
          onClick={onReload}
        >
          <RotateCw className="size-icon-sm" />
        </IconButton>
      </div>
    </div>
  );
}

/** 内容渲染：按预览类别分派，拿不到内联内容时退到占位 */
function Content({
  path,
  content,
  mode,
}: {
  path: string;
  content: FsReadResponse;
  mode: RenderMode;
}) {
  const { t } = useTranslation();
  const kind = previewKindOf(path);
  const size = formatBytes(content.size);

  if (kind === "image") {
    // SVG 是文本图片：源码形态与 markdown 的「源码」一致，交给同一套文本渲染器（按 xml 高亮）
    if (isTextImage(path) && mode === "source") {
      return content.text === undefined ? (
        <Empty
          className="h-full"
          icon={<FileWarning className="size-7" />}
          title={content.truncated ? t("文件太大，未内联内容") : t("二进制文件，无法预览")}
          hint={`${baseName(path)} · ${size}`}
        />
      ) : (
        <>
          <TextPreview path={path} text={content.text} />
          {content.truncated ? (
            <p className="border-t border-border px-3 py-2 text-xs text-foreground-subtle">
              {t("内容过大，已按上限截断")}
            </p>
          ) : null}
        </>
      );
    }

    // SVG 这类基于文本的图片服务端按文本下发，两条路都要认；文本截断时不拼（截断的 SVG 是坏的）
    const src = content.base64
      ? `data:${imageMimeOf(path)};base64,${content.base64}`
      : content.text !== undefined && !content.truncated
        ? `data:${imageMimeOf(path)};charset=utf-8,${encodeURIComponent(content.text)}`
        : null;
    return src ? (
      <div className="flex h-full items-center justify-center p-4">
        <img src={src} alt={baseName(path)} className="max-h-full max-w-full object-contain" />
      </div>
    ) : (
      <Empty
        className="h-full"
        icon={<ImageOff className="size-7" />}
        title={t("文件太大，未内联内容")}
        hint={`${baseName(path)} · ${size}`}
      />
    );
  }

  // 设计稿：预览就是画布（与设计视图里点开的是同一个组件），源码形态落到下面的文本渲染器
  if (kind === "design" && mode === "preview") {
    return <DesignCanvas path={path} />;
  }

  if (kind === "pdf" || kind === "document") {
    return (
      <Empty
        className="h-full"
        icon={<FileWarning className="size-7" />}
        title={t("这类文件还看不了，后续会接入渲染器")}
        hint={`${baseName(path)} · ${size}`}
      />
    );
  }

  if (content.text === undefined) {
    return (
      <Empty
        className="h-full"
        icon={
          content.kind === "binary" ? (
            <ImageOff className="size-7" />
          ) : (
            <FileWarning className="size-7" />
          )
        }
        title={content.truncated ? t("文件太大，未内联内容") : t("二进制文件，无法预览")}
        hint={`${baseName(path)} · ${size}`}
      />
    );
  }

  return (
    <>
      {kind === "markdown" && mode === "preview" ? (
        <MarkdownPreview text={content.text} />
      ) : (
        <TextPreview path={path} text={content.text} />
      )}
      {content.truncated ? (
        <p className="border-t border-border px-3 py-2 text-xs text-foreground-subtle">
          {t("内容过大，已按上限截断")}
        </p>
      ) : null}
    </>
  );
}

/** 单个文件的内容区；由外层用 `key={path}` 挂载，切换文件即重置渲染模式 */
export function FileContent({ path }: { path: string }) {
  const [reloadToken, setReloadToken] = useState(0);
  const [mode, setMode] = useState<RenderMode>(supportsRenderModes(path) ? "preview" : "source");
  const { data, error, loading } = useFileContent(path, reloadToken);

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col">
      <Toolbar
        path={path}
        size={data?.size ?? 0}
        mode={mode}
        onModeChange={setMode}
        reloading={loading}
        onReload={() => setReloadToken((token) => token + 1)}
      />
      <div className="min-h-0 flex-1 overflow-auto">
        {error ? (
          <Empty
            className="h-full"
            icon={<FileWarning className="size-7" />}
            title={error.message}
          />
        ) : loading && !data ? (
          <div className="flex h-full items-center justify-center">
            <Spinner className="text-foreground-subtle" />
          </div>
        ) : data ? (
          <Content path={data.path} content={data} mode={mode} />
        ) : null}
      </div>
    </div>
  );
}
