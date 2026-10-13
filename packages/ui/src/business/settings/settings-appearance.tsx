/** 外观设置：配色与深浅模式、界面字号与密度、字体、语言、消息区显示偏好与提醒方式 */
import type { Locale } from "@ucode/contracts";
import { useTheme } from "next-themes";
import { useTranslation } from "react-i18next";
import { Button } from "../../base/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../base/select";
import { Switch } from "../../base/switch";
import { useLocale } from "../../hooks/use-locale";
import { useNoticeEnabled } from "../../hooks/use-notice-enabled";
import { useShowThinking } from "../../hooks/use-show-thinking";
import { useSoundEnabled } from "../../hooks/use-sound-enabled";
import { type DensityId, FONT_SIZE_MAX, FONT_SIZE_MIN } from "../../lib/appearance";
import { UI_FONTS } from "../../lib/fonts";
import type { ColorThemeId } from "../../lib/themes";
import { useAppearance } from "../../provider/appearance-provider";
import { SegmentedControl, type SegmentedOption } from "../segmented-control";
import { SettingsGroup, SettingsRow } from "./settings-row";

type ThemeValue = "light" | "dark" | "system";

/** 界面字体选择器；等宽不走设置（系统栈固定），所以只有这一个旋钮 */
function UiFontSelect({
  value,
  label,
  onChange,
}: {
  value: string;
  label: string;
  onChange: (id: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label={label} className="w-40">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {UI_FONTS.map((option) => (
          // 系统字体没有专属名字，文案与其他选项的专名一起放在这里
          <SelectItem key={option.id} value={option.id}>
            {option.id === "system" ? t("系统默认") : option.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function SettingsAppearance() {
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();
  const { locale, setLocale } = useLocale();

  const themeOptions = [
    { value: "light", label: t("浅色") },
    { value: "dark", label: t("深色") },
    { value: "system", label: t("跟随系统") },
  ] as const satisfies ReadonlyArray<SegmentedOption<ThemeValue>>;

  const { showThinking, setShowThinking } = useShowThinking();

  // 语言一律用母语名展示，不随界面语言翻译
  const localeOptions = [
    { value: "zh-CN", label: t("中文") },
    { value: "en", label: "English" },
  ] as const satisfies ReadonlyArray<SegmentedOption<Locale>>;

  const value: ThemeValue = theme === "light" || theme === "dark" ? theme : "system";

  const { soundEnabled, setSoundEnabled, preview } = useSoundEnabled();

  const { prefs, setPrefs } = useAppearance();
  const colorThemeOptions = [
    { value: "default", label: t("默认") },
    { value: "zinc", label: t("冷灰") },
  ] as const satisfies ReadonlyArray<SegmentedOption<ColorThemeId>>;
  const densityOptions = [
    { value: "compact", label: t("紧凑") },
    { value: "default", label: t("默认") },
    { value: "cozy", label: t("宽松") },
  ] as const satisfies ReadonlyArray<SegmentedOption<DensityId>>;

  const { noticeEnabled, noticePermission, noticeBlocked, requestPermission, setNoticeEnabled } =
    useNoticeEnabled();

  // 开关开着却送不出去时要说清缺哪一步：浏览器授权只能在用户手势里申请，这里就是那个入口
  const noticeDescription = (): string => {
    if (!noticeEnabled) {
      return t("会话等待你的输入、完成或出错时发送系统通知；页面在前台时不打扰。");
    }
    // 桌面端问不到授权状态，只能按最近一次投递结果提示
    if (noticeBlocked) {
      return t("系统没有让通知通过，请检查系统的通知设置（macOS 上未签名的应用会被拦下）。");
    }
    if (noticePermission === "granted") {
      return t("会话等待你的输入、完成或出错时发送系统通知；页面在前台时不打扰。");
    }
    if (noticePermission === "default") {
      return t("浏览器还没有允许通知，点「允许通知」授权后才会送达。");
    }
    if (noticePermission === "denied") {
      return t("浏览器已拒绝通知，需要在浏览器的网站设置里允许后才能送达。");
    }
    return t("当前环境不支持系统通知。");
  };

  return (
    <SettingsGroup>
      <SettingsRow
        title={t("界面主题")}
        description={t("深色模式下的配色与浅色模式一一对应，切换后立即生效并记住选择。")}
        control={
          <SegmentedControl
            label={t("界面主题")}
            value={value}
            options={themeOptions}
            onChange={setTheme}
          />
        }
      />
      <SettingsRow
        title={t("配色主题")}
        description={t("换一组颜色，字体、字号与圆角不受影响。")}
        control={
          <SegmentedControl
            label={t("配色主题")}
            value={prefs.theme}
            options={colorThemeOptions}
            onChange={(next) => setPrefs({ theme: next })}
          />
        }
      />
      <SettingsRow
        title={t("界面字号")}
        description={t("控制文字与图标的大小；间距与控件高度由界面密度决定。")}
        control={
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={FONT_SIZE_MIN}
              max={FONT_SIZE_MAX}
              step={1}
              value={prefs.fontSizeBase}
              onChange={(event) => setPrefs({ fontSizeBase: Number(event.target.value) })}
              aria-label={t("界面字号")}
              className="h-1.5 w-40 cursor-pointer appearance-none rounded-full bg-muted accent-primary"
            />
            <span className="w-10 text-right text-xs tabular-nums text-foreground-subtle">
              {prefs.fontSizeBase}px
            </span>
          </div>
        }
      />
      <SettingsRow
        title={t("界面密度")}
        description={t("控制间距、控件高度与栏宽；不影响文字大小。")}
        control={
          <SegmentedControl
            label={t("界面密度")}
            value={prefs.density}
            options={densityOptions}
            onChange={(next) => setPrefs({ density: next })}
          />
        }
      />
      <SettingsRow
        title={t("界面字体")}
        description={t("界面文字使用的字体，选中后按需加载并立即生效。")}
        control={
          <UiFontSelect
            value={prefs.uiFont}
            label={t("界面字体")}
            onChange={(id) => setPrefs({ uiFont: id })}
          />
        }
      />
      <SettingsRow
        title={t("显示思考过程")}
        description={t("在消息区展示模型的思考过程；关闭后只保留回答与工具调用。")}
        control={
          <Switch
            checked={showThinking}
            onCheckedChange={setShowThinking}
            aria-label={t("显示思考过程")}
          />
        }
      />
      <SettingsRow
        title={t("消息通知")}
        description={noticeDescription()}
        control={
          <div className="flex items-center gap-2">
            {noticeEnabled && noticePermission === "default" ? (
              <Button variant="outline" size="sm" onClick={() => void requestPermission()}>
                {t("允许通知")}
              </Button>
            ) : null}
            <Switch
              checked={noticeEnabled}
              onCheckedChange={setNoticeEnabled}
              aria-label={t("消息通知")}
            />
          </div>
        }
      />
      <SettingsRow
        title={t("提示音")}
        description={t(
          "等待输入、本轮完成或出错时播放提示音；与系统通知各自独立，页面在前台也会响。",
        )}
        control={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={preview}>
              {t("试听")}
            </Button>
            <Switch
              checked={soundEnabled}
              onCheckedChange={setSoundEnabled}
              aria-label={t("提示音")}
            />
          </div>
        }
      />
      <SettingsRow
        title={t("语言")}
        description={t("界面语言，切换后立即生效并记住选择。")}
        control={
          <SegmentedControl
            label={t("语言")}
            value={locale}
            options={localeOptions}
            onChange={setLocale}
          />
        }
      />
    </SettingsGroup>
  );
}
