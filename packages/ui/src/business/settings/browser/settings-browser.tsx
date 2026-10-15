/**
 * 设置页的浏览器分节：连接配置（进配置草稿）+ 已保留的数据（实时列表）。
 */
import type { DraftBrowser } from "../config-draft";
import { SettingsBrowserConnection } from "./settings-browser-connection";
import { SettingsBrowserProfiles } from "./settings-browser-profiles";

type SettingsBrowserProps = {
  browser: DraftBrowser;
  onPatch: (patch: Partial<DraftBrowser>) => void;
};

export function SettingsBrowser({ browser, onPatch }: SettingsBrowserProps) {
  return (
    <div className="space-y-6">
      <SettingsBrowserConnection browser={browser} onPatch={onPatch} />
      <SettingsBrowserProfiles />
    </div>
  );
}
