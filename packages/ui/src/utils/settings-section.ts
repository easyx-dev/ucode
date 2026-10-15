/**
 * 设置界面的分区与分组 id：导航顺序、页面分发与 URL 查询串共用这一份定义。
 *
 * 只放 id——分区标题是 i18n key（key 就是中文文案本身），配在 `business/settings/settings-sections.tsx`；
 * 数据文件里出现中文字面量会被 i18n 校验判为硬编码。
 */
export const SETTINGS_SECTION_IDS = [
  "appearance",
  "models",
  "defaults",
  "agents",
  "skills",
  "commands",
  "memory",
  "websearch",
  "browser",
  "mcp",
  "plugins",
  "remote",
] as const;

export type SettingsSectionId = (typeof SETTINGS_SECTION_IDS)[number];

export const SETTINGS_GROUP_IDS = ["basics", "agent", "service"] as const;

export type SettingsGroupId = (typeof SETTINGS_GROUP_IDS)[number];

/** 导航分组：每组内的分区按数组顺序渲染 */
export const SETTINGS_GROUP_SECTIONS: Record<SettingsGroupId, readonly SettingsSectionId[]> = {
  basics: ["appearance", "models", "defaults"],
  agent: ["agents", "skills", "commands", "memory", "websearch", "browser", "mcp", "plugins"],
  service: ["remote"],
};

/** 打开设置（侧栏、空态与命令面板入口）时默认落在哪一页 */
export const DEFAULT_SETTINGS_SECTION: SettingsSectionId = "models";

/** 收窄外部传值（URL 查询串、localStorage 等）用的校验 */
export const isSettingsSectionId = (value: string | null | undefined): value is SettingsSectionId =>
  SETTINGS_SECTION_IDS.some((id) => id === value);
