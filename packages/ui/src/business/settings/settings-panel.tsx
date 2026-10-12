/**
 * 设置界面：全屏对话框，左侧分类导航 + 右侧内容页。
 *
 * 打开即拉草稿，导航切页不丢改动；「保存并生效」成功后关闭回工作区。
 */
import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../../base/dialog";
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
function DraftDefaultsPage({ title, draft }: { title: string; draft: ConfigDraft }) {
  return (
    <SettingsPage title={title}>
      <SettingsDefaults
        options={draft.options}
        defaultModel={draft.defaultModel}
        onSelectDefaultModel={draft.setDefaultModel}
      />
    </SettingsPage>
  );
}

function DraftWebsearchPage({ title, draft }: { title: string; draft: ConfigDraft }) {
  return (
    <SettingsPage title={title}>
      <SettingsWebsearch websearch={draft.websearch} onPatch={draft.patchWebsearch} />
    </SettingsPage>
  );
}

function DraftMemoryPage({ title, draft }: { title: string; draft: ConfigDraft }) {
  return (
    <SettingsPage title={title}>
      <SettingsMemory enabled={draft.memoryEnabled} onChange={draft.setMemoryEnabled} />
    </SettingsPage>
  );
}

/** 分区 → 页面：模型页自持页头动作与两栏布局，其余页面由 SettingsPage 排布 */
function SectionContent({
  section,
  draft,
  testingKey,
  onTest,
}: Pick<SettingsPanelProps, "section"> & {
  draft: ConfigDraft;
  testingKey: string | null;
  onTest: ConfigSave["test"];
}) {
  const meta = useSettingsSectionMeta();

  switch (section) {
    case "models":
      return (
        <SettingsModels
          title={meta.models.label}
          draft={draft}
          testingKey={testingKey}
          onTest={onTest}
        />
      );
    case "defaults":
      return <DraftDefaultsPage title={meta.defaults.label} draft={draft} />;
    case "websearch":
      return <DraftWebsearchPage title={meta.websearch.label} draft={draft} />;
    case "memory":
      return <DraftMemoryPage title={meta.memory.label} draft={draft} />;
    case "appearance":
      return (
        <SettingsPage title={meta.appearance.label}>
          <SettingsAppearance />
        </SettingsPage>
      );
    case "mcp":
      return (
        <SettingsPage title={meta.mcp.label}>
          <SettingsMcp />
        </SettingsPage>
      );
    case "plugins":
      return (
        <SettingsPage title={meta.plugins.label}>
          <SettingsPlugins />
        </SettingsPage>
      );
    case "remote":
      return (
        <SettingsPage title={meta.remote.label}>
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
          <SectionContent section={section} draft={draft} testingKey={testingKey} onTest={test} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
