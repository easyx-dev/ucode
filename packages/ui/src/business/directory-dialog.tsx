/** 会话目录对话框：只读浏览会话的工作目录，复用 fs/list */
import { ArrowUp, FileText, Folder } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../base/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../base/dialog";
import { ScrollArea } from "../base/scroll-area";
import { Spinner } from "../base/spinner";
import { errorText } from "../lib/error";
import { abbreviateHome } from "../lib/path";
import type { FsListResponse } from "../lib/types";
import { useClient } from "../provider";

/** 文件大小展示：只用于浏览，按 1024 进制取一位小数 */
const formatSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  return kb < 1024 ? `${kb.toFixed(1)} KB` : `${(kb / 1024).toFixed(1)} MB`;
};

type DirectoryDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 会话的工作目录；null 表示还没有会话 */
  path: string | null;
};

export function DirectoryDialog({ open, onOpenChange, path }: DirectoryDialogProps) {
  const { t } = useTranslation();
  const client = useClient();
  const [listing, setListing] = useState<FsListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  /** 请求序号：只采纳最后一次发出的请求，丢弃乱序返回的旧结果 */
  const requestRef = useRef(0);

  const navigateTo = useCallback(
    async (target: string): Promise<void> => {
      const requestId = ++requestRef.current;
      setLoading(true);
      setError(null);
      try {
        const data = await client.apis.fs.list({ path: target });
        if (requestId !== requestRef.current) return;
        setListing(data);
      } catch (err) {
        if (requestId !== requestRef.current) return;
        setListing(null);
        setError(errorText(t, err));
      } finally {
        if (requestId === requestRef.current) setLoading(false);
      }
    },
    [client, t],
  );

  // 每次打开都从会话目录开始，避免残留上一次的位置
  useEffect(() => {
    if (!open || !path) return;
    setListing(null);
    setError(null);
    void navigateTo(path);
  }, [open, path, navigateTo]);

  // 已到会话目录：不再允许向上越出它
  const atRoot = !listing || !path || listing.path === path;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("目录")}</DialogTitle>
          <DialogDescription>
            {t("这个会话的工作目录：agent 读写文件、执行命令都在这里。")}
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            className="size-8 shrink-0"
            title={t("返回上级")}
            disabled={!listing?.parent || atRoot || loading}
            onClick={() => listing?.parent && void navigateTo(listing.parent)}
          >
            <ArrowUp className="size-3.5" />
          </Button>
          <code className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
            {listing ? abbreviateHome(listing.path) : (path && abbreviateHome(path)) || ""}
          </code>
        </div>

        {error ? <p className="text-destructive text-xs">{error}</p> : null}

        <ScrollArea className="h-72 rounded-md border">
          <div className="p-1">
            {loading && !listing ? (
              <p className="flex items-center gap-2 px-2 py-2 text-xs text-muted-foreground">
                <Spinner className="size-3.5" />
                {t("加载中…")}
              </p>
            ) : null}

            {listing && listing.entries.length === 0 ? (
              <p className="px-2 py-2 text-xs text-muted-foreground">{t("暂无文件")}</p>
            ) : null}

            {listing?.entries.map((entry) => {
              const directory = entry.type === "directory";
              return (
                <button
                  key={entry.path}
                  type="button"
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50 disabled:hover:bg-transparent"
                  disabled={!directory}
                  onClick={() => void navigateTo(entry.path)}
                >
                  {directory ? (
                    <Folder className="size-3.5 shrink-0 text-muted-foreground" />
                  ) : (
                    <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                  )}
                  <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                  {directory ? null : (
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {formatSize(entry.size)}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
