/**
 * 已保留的浏览器数据：每份 profile 的占用与最后使用时间，可单独删除或清空。
 *
 * 删除前走函数式确认层（见 `docs/components.md`「弹层的调用方式」），破坏性动作的确认按钮写「删除」。
 * 正在使用中的份由服务端跳过，这里也把按钮置灰并说明原因——让用户先关掉实例，而不是点了没反应。
 */
import type { BrowserProfileView } from "@ucode/contracts";
import type { TFunction } from "i18next";
import { HardDrive, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button, IconButton } from "../../../base/button";
import { Empty } from "../../../base/empty";
import { Spinner } from "../../../base/spinner";
import { formatBytes } from "../../../utils/preview";
import { relativeTimeLabel } from "../../../utils/time";
import { confirm } from "../../dialog/queue";
import { SettingsSectionHeader } from "../settings-page";
import { useBrowserProfiles } from "./use-browser-profiles";

/** 一行的元信息：占用（不精确时加「约」）+ 最后使用时间 */
function profileMeta(profile: BrowserProfileView, t: TFunction): string {
  const bytes = formatBytes(profile.bytes);
  const size = profile.exact
    ? t("占用 {{size}}", { size: bytes })
    : t("至少占用 {{size}}", { size: bytes });
  const used = profile.lastUsedAt ? relativeTimeLabel(profile.lastUsedAt) : "";
  return used ? `${size} · ${used}` : size;
}

export function SettingsBrowserProfiles() {
  const { t } = useTranslation();
  const { profiles, root, loading, deleting, remove } = useBrowserProfiles();

  const deleteOne = async (profile: BrowserProfileView): Promise<void> => {
    const okToDelete = await confirm({
      title: t("删除 profile「{{name}}」？", { name: profile.name }),
      description: t("里面的 cookie 与站点数据会一并删除，且不可恢复。"),
      confirmText: t("删除"),
      destructive: true,
    });
    if (!okToDelete) return;
    const result = await remove([profile.name]);
    if (result) toast.success(t("已删除 {{count}} 份浏览器数据", { count: result.deleted.length }));
  };

  const deleteAll = async (): Promise<void> => {
    const names = (profiles ?? [])
      .filter((profile) => !profile.inUse)
      .map((profile) => profile.name);
    const okToDelete = await confirm({
      title: t("清空所有浏览器 profile？"),
      description: t("共 {{count}} 份数据会被删除，正在使用中的会跳过。", { count: names.length }),
      confirmText: t("清空全部"),
      destructive: true,
    });
    if (!okToDelete) return;
    const result = await remove(names);
    if (result) {
      toast.success(t("已删除 {{count}} 份浏览器数据", { count: result.deleted.length }));
      if (result.skipped.length > 0) {
        toast.warning(t("有 {{count}} 份正在使用中，未删除", { count: result.skipped.length }));
      }
    }
  };

  const clearable = (profiles ?? []).filter((profile) => !profile.inUse).length;

  return (
    <section className="space-y-3">
      <SettingsSectionHeader
        title={t("数据")}
        meta={profiles ? t("{{count}} 份", { count: profiles.length }) : null}
        action={
          clearable > 0 ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void deleteAll()}
              disabled={deleting}
            >
              {t("清空全部")}
            </Button>
          ) : null
        }
      />

      {loading && profiles === null ? (
        <div className="flex justify-center py-8">
          <Spinner />
        </div>
      ) : profiles === null || profiles.length === 0 ? (
        <Empty
          className="rounded-xl border border-dashed px-6 py-9"
          icon={<HardDrive className="size-icon-lg" />}
          title={t("还没有保留任何浏览器数据")}
          hint={t("用 profile 名打开过页面后，数据会落在这里，可以随用随清。")}
        />
      ) : (
        <ul className="space-y-2">
          {profiles.map((profile) => (
            <li
              key={profile.name}
              className="flex items-center justify-between gap-4 rounded-xl border px-4 py-3"
            >
              <div className="min-w-0 space-y-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">{profile.name}</span>
                  {profile.inUse ? (
                    <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-xs text-foreground-subtle">
                      {t("使用中")}
                    </span>
                  ) : null}
                </div>
                <p className="truncate text-sm text-foreground-subtle">{profileMeta(profile, t)}</p>
              </div>
              <IconButton
                label={t("删除")}
                variant="ghost"
                size="sm"
                disabled={profile.inUse || deleting}
                onClick={() => void deleteOne(profile)}
              >
                <Trash2 className="size-icon-base" />
              </IconButton>
            </li>
          ))}
        </ul>
      )}

      {root ? (
        <p className="text-xs text-foreground-subtle break-all">
          {t("存放位置：{{path}}", { path: root })}
        </p>
      ) : null}
    </section>
  );
}
