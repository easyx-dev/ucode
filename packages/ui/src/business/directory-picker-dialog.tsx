/** 目录选择对话框：浏览 / 直接输入路径（结尾 `/` 进入目录，否则按末段检索）/ 新建文件夹 / 选定目录 */
/**
 * 目录选择弹层：浏览 / 直接输入路径（结尾 `/` 进入目录，否则按末段检索）/ 新建文件夹 / 选定目录。
 *
 * 函数式入口 `openDirectoryPickerDialog`；挂载即打开，不再受控 `open`。
 */
import { ArrowUp, Folder, FolderPlus } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "../base/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "../base/dialog";
import { Input } from "../base/input";
import { ScrollArea } from "../base/scroll-area";
import { Spinner } from "../base/spinner";
import { openDialog } from "../lib/dialog";
import { errorText } from "../lib/error";
import { baseName, dirName, joinPath } from "../lib/path";
import type { FsListRequest, FsListResponse } from "../lib/types";
import { useClient } from "../provider";

/** 输入停顿多久后自动定位，避免边打字边跳目录 */
const PATH_DEBOUNCE_MS = 400;

/** 浏览态的输入框展示：补结尾 `/`，与「带 `/` 即目录」的输入规则保持一致 */
const toDirectoryInput = (path: string): string => (path.endsWith("/") ? path : `${path}/`);

/** 一次目录请求的结果；`stale` 表示已被更新的请求取代，调用方应直接放弃 */
type ListOutcome =
  | { status: "ok"; data: FsListResponse }
  | { status: "error"; error: unknown }
  | { status: "stale" };

type DirectoryPickerDialogProps = {
  /** 确认选择；返回浏览到的绝对路径，由服务端再归一化 */
  onSelect: (path: string) => void;
  /** 取消 / Esc / 点遮罩：不选目录收起 */
  onCancel: () => void;
  /**
   * 选目录（缺省）还是选文件。选文件时点文件即确认，底部的「选择此目录」与「新建文件夹」隐藏
   * ——插件配置里的文件路径必须落在某个文件上，让用户再点一次确认只是多一步。
   */
  select?: "directory" | "file";
};

export function DirectoryPickerDialog({
  onSelect,
  onCancel,
  select = "directory",
}: DirectoryPickerDialogProps) {
  const pickingFile = select === "file";
  const { t } = useTranslation();
  const client = useClient();
  const [listing, setListing] = useState<FsListResponse | null>(null);
  const [pathInput, setPathInput] = useState("");
  /** 当前生效的检索词；非空时列表是检索结果而非目录内容 */
  const [query, setQuery] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [folderName, setFolderName] = useState("");
  /** 请求序号：只采纳最后一次发出的请求，丢弃乱序返回的旧结果 */
  const requestRef = useRef(0);
  /** 已按输入框内容处理过的路径；防抖据此判重，也避免回写覆盖用户正在编辑的文本 */
  const requestedRef = useRef<string | null>(null);

  const request = useCallback(
    async (params: FsListRequest): Promise<ListOutcome> => {
      const requestId = ++requestRef.current;
      try {
        const data = await client.apis.fs.list(params);
        return requestId === requestRef.current ? { status: "ok", data } : { status: "stale" };
      } catch (error) {
        return requestId === requestRef.current ? { status: "error", error } : { status: "stale" };
      }
    },
    [client],
  );

  /** 点击 / 返回上级 / 打开弹层：加载目录并把输入框对齐成归一化路径 */
  const navigateTo = useCallback(
    async (path?: string): Promise<void> => {
      setLoading(true);
      setError(null);
      const outcome = await request(path ? { path, type: "directory" } : { type: "directory" });
      if (outcome.status === "stale") return;
      setLoading(false);
      if (outcome.status === "ok") {
        const input = toDirectoryInput(outcome.data.path);
        setListing(outcome.data);
        setQuery(null);
        requestedRef.current = input;
        setPathInput(input);
        return;
      }
      setListing(null);
      setQuery(null);
      setError(errorText(t, outcome.error));
    },
    [request, t],
  );

  /**
   * 输入框防抖定位：结尾带 `/` 视为目录本身（进入浏览）；
   * 否则把末段当检索词，在上级目录里按名称过滤；不含 `/` 的裸词视为当前目录内的检索。
   * 只加载、不回写输入框，避免打断打字与选区。
   */
  const locate = useCallback(
    async (raw: string): Promise<void> => {
      const next = raw.trim();
      if (!next || next === requestedRef.current) return;
      requestedRef.current = next;
      setLoading(true);
      setError(null);

      if (next.endsWith("/")) {
        const outcome = await request({ path: next, type: "directory" });
        if (outcome.status === "stale") return;
        setLoading(false);
        if (outcome.status === "ok") {
          setListing(outcome.data);
          setQuery(null);
          return;
        }
        setListing(null);
        setQuery(null);
        setError(errorText(t, outcome.error));
        return;
      }

      // 含 `/` 时在上级目录检索末段；裸词在当前目录里检索
      const dir = next.includes("/") ? dirName(next) : listing?.path;
      const name = baseName(next);
      if (!dir || !name) {
        setLoading(false);
        return;
      }

      const outcome = await request({ path: dir, q: name, type: "directory" });
      if (outcome.status === "stale") return;
      setLoading(false);
      if (outcome.status === "ok") {
        setListing(outcome.data);
        setQuery(name);
        return;
      }
      setListing(null);
      setQuery(null);
      setError(errorText(t, outcome.error));
    },
    [request, listing?.path, t],
  );

  // 挂载即打开：每次打开都从用户 home 重新开始，避免残留上一次的位置
  useEffect(() => {
    void navigateTo();
  }, [navigateTo]);

  // 输入防抖：停顿后自动定位；无输入或已处理过则跳过
  useEffect(() => {
    const next = pathInput.trim();
    if (!next || next === requestedRef.current) return;
    const timer = setTimeout(() => void locate(next), PATH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [pathInput, locate]);

  const submitFolder = async () => {
    const name = folderName.trim();
    if (!listing || !name) return;
    try {
      await client.apis.fs.mkdir(joinPath(listing.path, name));
      setCreating(false);
      setFolderName("");
      await navigateTo(listing.path);
    } catch (err) {
      toast.error(t("失败提示.模板", { label: t("创建文件夹失败"), reason: errorText(t, err) }));
    }
  };

  const emptyText = query ? t("没有匹配的目录") : t("此处没有子目录");

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("选择目录")}</DialogTitle>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            className="size-8 shrink-0"
            title={t("返回上级")}
            disabled={!listing?.parent || loading}
            onClick={() => listing?.parent && void navigateTo(listing.parent)}
          >
            <ArrowUp className="size-icon-sm" />
          </Button>
          <Input
            value={pathInput}
            spellCheck={false}
            placeholder={t("输入绝对路径")}
            className="h-8 min-w-0 flex-1 text-xs"
            onChange={(event) => setPathInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void locate(pathInput);
            }}
          />
          <Button
            variant="outline"
            size="sm"
            className="h-8 shrink-0"
            disabled={!listing || loading}
            onClick={() => setCreating((prev) => !prev)}
          >
            <FolderPlus className="size-icon-sm" />
            {t("新建文件夹")}
          </Button>
        </div>

        {error ? <p className="text-destructive text-xs">{error}</p> : null}

        {creating ? (
          <div className="flex items-center gap-2">
            <Input
              autoFocus
              value={folderName}
              placeholder={t("文件夹名")}
              onChange={(event) => setFolderName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void submitFolder();
              }}
            />
            <Button size="sm" disabled={!folderName.trim()} onClick={() => void submitFolder()}>
              {t("新建")}
            </Button>
          </div>
        ) : null}

        <ScrollArea className="h-72 rounded-md border">
          <div className="p-1">
            {loading && !listing ? (
              <p className="flex items-center gap-2 px-2 py-2 text-xs text-foreground-subtle">
                <Spinner className="size-icon-sm" />
                {t("加载中…")}
              </p>
            ) : null}

            {listing && listing.entries.length === 0 ? (
              <p className="px-2 py-2 text-xs text-foreground-subtle">{emptyText}</p>
            ) : null}

            {listing?.entries.map((entry) => (
              <button
                key={entry.path}
                type="button"
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none hover:bg-state-hover focus-visible:ring-2 focus-visible:ring-ring/50"
                onClick={() => {
                  // 选文件模式：目录继续下钻，文件即确认
                  if (pickingFile && entry.type !== "directory") onSelect(entry.path);
                  else void navigateTo(entry.path);
                }}
              >
                <Folder className="size-icon-sm shrink-0 text-foreground-subtle" />
                <span className="truncate">{entry.name}</span>
              </button>
            ))}
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            {t("取消")}
          </Button>
          {pickingFile ? null : (
            <Button
              disabled={!listing}
              onClick={() => {
                if (listing) onSelect(listing.path);
              }}
            >
              {t("选择此目录")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** 打开选择弹层；返回选中的绝对路径，取消返回 null */
export const openDirectoryPickerDialog = (
  input: { select?: "directory" | "file" } = {},
): Promise<string | null> =>
  openDialog<string>((close) => (
    <DirectoryPickerDialog
      onSelect={(path) => close(path)}
      onCancel={() => close()}
      {...(input.select ? { select: input.select } : {})}
    />
  )).then((path) => path ?? null);
