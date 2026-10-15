/**
 * 浏览器工具怎么连：连接方式、attach 的调试端点、默认 profile 名。
 *
 * 单独成模块（不依赖 client）：这一部分是纯表单，能脱离数据面做渲染单测；
 * 数据列表在 settings-browser-profiles 里另接。
 */
import { useTranslation } from "react-i18next";
import { Input } from "../../../base/input";
import { SegmentedControl } from "../../../base/segmented-control";
import type { DraftBrowser } from "../config-draft";
import { SettingsGroup, SettingsRow } from "../settings-row";

export type SettingsBrowserConnectionProps = {
  browser: DraftBrowser;
  onPatch: (patch: Partial<DraftBrowser>) => void;
};

export function SettingsBrowserConnection({ browser, onPatch }: SettingsBrowserConnectionProps) {
  const { t } = useTranslation();

  return (
    <SettingsGroup>
      <SettingsRow
        title={t("连接方式")}
        description={t(
          "自己启动：由服务进程拉起一个受管浏览器，关掉即回收。连接已有实例：只连你启动的调试实例，不会动你已打开的页面。",
        )}
        control={
          <SegmentedControl
            label={t("连接方式")}
            value={browser.mode}
            onChange={(mode) => onPatch({ mode })}
            options={[
              { value: "isolated", label: t("自己启动") },
              { value: "attach", label: t("连接已有实例") },
            ]}
          />
        }
      />

      {browser.mode === "attach" ? (
        <SettingsRow
          title={t("调试端点")}
          description={t(
            "agent 将能操作该实例里已登录的站点，请只连你愿意交给它的实例。实例要用 --remote-debugging-port 启动，Chrome 136 起还必须配一个非默认的 --user-data-dir。",
          )}
          control={
            <Input
              className="w-64"
              value={browser.endpoint}
              placeholder={t("如 http://127.0.0.1:9222")}
              aria-label={t("调试端点")}
              onChange={(event) => onPatch({ endpoint: event.target.value })}
            />
          }
        />
      ) : null}

      <SettingsRow
        title={t("默认 profile")}
        description={t(
          "填了名字就把这份数据长期保留（cookie 与登录态跨会话仍在，同名 profile 的会话共用）；留空则每次都用临时目录，实例关掉即删。",
        )}
        control={
          <Input
            className="w-48"
            value={browser.profile}
            placeholder={t("留空即不保留")}
            aria-label={t("默认 profile")}
            onChange={(event) => onPatch({ profile: event.target.value })}
          />
        }
      />
    </SettingsGroup>
  );
}
