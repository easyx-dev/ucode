/**
 * 提示音的呈现层：一段内置音频，收到该提醒的事件时响一声。
 *
 * 「什么时候该响」在 `hooks/use-session-notices`，这里只管怎么发声与开关的持久化。
 * 播不出来（浏览器拦住自动播放 / 音频文件缺失）一律静默降级：提示音是补充通道。
 */
import { brand } from "@ucode/brand";
import notifySoundUrl from "../../assets/notify.wav";
import { readStorage, writeStorage } from "../../utils/storage";

/** 提示音开关的持久化键：纯本机界面偏好，不进服务端配置 */
const ENABLED_KEY = `${brand.slug}-notice-sound-enabled`;

/** 提示音开关：读不到（首次、隐私模式）按开启处理 */
export const readSoundEnabled = (): boolean => readStorage(ENABLED_KEY) !== "0";

export const writeSoundEnabled = (enabled: boolean): void =>
  writeStorage(ENABLED_KEY, enabled ? "1" : "0");

/**
 * 复用一个音频元素：连续来消息时不该叠着响好几个，
 * 从头播当前这一声即可（`currentTime = 0` 之后再 `play`）。
 */
let audio: HTMLAudioElement | null = null;

const audioElement = (): HTMLAudioElement => {
  audio ??= new Audio(notifySoundUrl);
  return audio;
};

/** 响一声提示音；被自动播放策略拦住时静默放弃 */
export const playNoticeSound = (): void => {
  try {
    const element = audioElement();
    element.currentTime = 0;
    void element.play().catch(() => {});
  } catch {
    // 环境不支持音频（个别嵌入式 WebView）时不影响主流程
  }
};
