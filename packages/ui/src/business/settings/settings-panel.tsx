/**
 * 设置界面：全屏面板，左侧分类导航 + 右侧内容页。
 *
 * 打开即拉草稿，导航切页不丢改动；「保存并生效」成功后关闭回工作区。
 * 保存区由这一层构造并交给各分区页的页头（草稿模式的唯一提交入口）。
 */
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../base/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../../base/dialog";
import { Spinner } from "../../base/spinner";
import { type ConfigDraft, useConfigDraft } from "../../hooks/use-config-draft";
import { type ConfigSave, useConfigSave } from "../../hooks/use-config-save";
import type { SettingsSectionId } from "../../lib/settings-section";
import { SettingsAppearance } from "./settings-appearance";
import { SettingsDefaults } from "./settings-defaults";
import { SettingsMcp } from "./settings-mcp";
import { SettingsMemory } from "./settings-memory";
import { SettingsModels } from "./settings-models";
import { SettingsNav } from "./settings-nav";
import { SettingsPage } from "./settings-page";
import { SettingsPlugins } from "./settings-plugins";
import { SettingsRemoteAccess } from "./settings-remote-access";
import { useSettingsSectionMeta } from "./settings-sections";
import { SettingsWebsearch } from "./settings-websearch";

type SettingsPanelProps = {
  /** 无标题栏窗口顶部留给系统窗口控件的高度（px）；带系统标题栏的窗口不需要（默认 0） */
  titleBarInset?: number;
  section: SettingsSectionId;
  onSectionChange: (section: SettingsSectionId) => void;
  /** 关闭设置：丢弃未保存的草稿并回工作区 */
  onClose: () => void;
  /** 保存成功后的回调：刷新模型目录与会话列表 */
  onSaved: () => void;
};

/** 需要草稿字段的页面：动作绑定在这里，排布仍交给 SettingsPage */
function DraftDefaultsPage({
  title,
  draft,
  saveActions,
}: {
  title: string;
  draft: ConfigDraft;
  saveActions: ReactNode;
}) {
  return (
    <SettingsPage title={title} trailing={saveActions}>
      <SettingsDefaults
        options={draft.options}
        defaultModel={draft.defaultModel}
        onSelectDefaultModel={draft.setDefaultModel}
      />
    </SettingsPage>
  );
}

function DraftWebsearchPage({
  title,
  draft,
  saveActions,
}: {
  title: string;
  draft: ConfigDraft;
  saveActions: ReactNode;
}) {
  return (
    <SettingsPage title={title} trailing={saveActions}>
      <SettingsWebsearch websearch={draft.websearch} onPatch={draft.patchWebsearch} />
    </SettingsPage>
  );
}

function DraftMemoryPage({
  title,
  draft,
  saveActions,
}: {
  title: string;
  draft: ConfigDraft;
  saveActions: ReactNode;
}) {
  return (
    <SettingsPage title={title} trailing={saveActions}>
      <SettingsMemory enabled={draft.memoryEnabled} onChange={draft.setMemoryEnabled} />
    </SettingsPage>
  );
}

/** 分区 → 页面：分区页的页头文案与页面动作都在这里定，排布仍归各页自己 */
function SectionContent({
  section,
  draft,
  saveActions,
  testingKey,
  onTest,
}: Pick<SettingsPanelProps, "section"> & {
  draft: ConfigDraft;
  saveActions: ReactNode;
  testingKey: string | null;
  onTest: ConfigSave["test"];
}) {
  const { t } = useTranslation();
  const meta = useSettingsSectionMeta();

  switch (section) {
    case "models":
      return (
        <SettingsModels
          title={meta.models.label}
          description={t("保存后新配置从下一轮开始生效；apiKey 留空表示沿用已保存的 key。")}
          trailing={saveActions}
          draft={draft}
          testingKey={testingKey}
          onTest={onTest}
        />
      );
    case "defaults":
      return (
        <DraftDefaultsPage title={meta.defaults.label} draft={draft} saveActions={saveActions} />
      );
    case "websearch":
      return (
        <DraftWebsearchPage title={meta.websearch.label} draft={draft} saveActions={saveActions} />
      );
    case "memory":
      return <DraftMemoryPage title={meta.memory.label} draft={draft} saveActions={saveActions} />;
    case "appearance":
      return (
        <SettingsPage title={meta.appearance.label} trailing={saveActions}>
          <SettingsAppearance />
        </SettingsPage>
      );
    case "mcp":
      return (
        <SettingsPage
          title={meta.mcp.label}
          description={t(
            "接入 MCP（Model Context Protocol）服务器，为 agent 增加外部工具；改动写入本机配置文件，新会话生效。",
          )}
          trailing={saveActions}
        >
          <SettingsMcp />
        </SettingsPage>
      );
    case "plugins":
      return (
        <SettingsPage
          title={meta.plugins.label}
          description={t("管理插件的启停、配置与来源。")}
          trailing={saveActions}
        >
          <SettingsPlugins />
        </SettingsPage>
      );
    case "remote":
      return (
        <SettingsPage
          title={meta.remote.label}
          description={t(
            "让同一网络下的设备接入本服务。通过鉴权的设备等于本机 owner，可驱动 agent 读写文件、执行命令。",
          )}
          trailing={saveActions}
        >
          <SettingsRemoteAccess />
        </SettingsPage>
      );
  }
}

export function SettingsPanel({
  titleBarInset = 0,
  section,
  onSectionChange,
  onClose,
  onSaved,
}: SettingsPanelProps) {
  const { t } = useTranslation();
  const draft = useConfigDraft(true);
  const { saving, testingKey, save, test } = useConfigSave(draft, onSaved);

  const handleSave = async (): Promise<void> => {
    if (await save()) onClose();
  };

  const saveActions = (
    <>
      <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>
        {t("取消")}
      </Button>
      <Button size="sm" onClick={() => void handleSave()} disabled={saving || draft.loading}>
        {saving ? <Spinner className="size-icon-sm" /> : null}
        {t("保存并生效")}
      </Button>
    </>
  );

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      {/*
        DialogContent 的定位与尺寸由基础类给出（居中 + max-w-sm），全屏要逐项覆盖，
        同属性类的生成顺序不可靠，故关键项一律加 `!`。
      */}
      <DialogContent
        showCloseButton={false}
        className="top-0! left-0! h-dvh! w-screen! max-w-none! translate-x-0! translate-y-0! gap-0! rounded-none! bg-background! p-0! text-foreground! ring-0! sm:max-w-none! data-open:zoom-in-100!"
      >
        <DialogTitle className="sr-only">{t("设置")}</DialogTitle>
        <DialogDescription className="sr-only">
          {t(
            "外观、模型与联网搜索配置。保存后新配置从下一轮开始生效；apiKey 留空表示沿用已保存的 key。",
          )}
        </DialogDescription>

        {/* 留白加在这一层：面板自身的 `p-0!` 是 `!important`，内联 padding 会被它压掉 */}
        <div
          className="flex h-full min-h-0 min-w-0 flex-col md:flex-row"
          style={{ paddingTop: titleBarInset }}
        >
          <SettingsNav
            section={section}
            onSectionChange={onSectionChange}
            onClose={onClose}
            saving={saving}
            loading={draft.loading}
            onSave={() => void handleSave()}
          />
          <SectionContent
            section={section}
            draft={draft}
            saveActions={saveActions}
            testingKey={testingKey}
            onTest={test}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
