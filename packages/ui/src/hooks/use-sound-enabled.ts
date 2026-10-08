/**
 * 「提示音」开关的 React 绑定：设置页读写开关并试听。
 *
 * 触发点每次发声前现读 localStorage，故不需要跨组件广播；这里只为设置页提供受控值。
 */
import { useState } from "react";

import { playNoticeSound, readSoundEnabled, writeSoundEnabled } from "../lib/sound";

export function useSoundEnabled(): {
  soundEnabled: boolean;
  setSoundEnabled: (next: boolean) => void;
  /** 试听：不受开关限制，用来挑一个合适的音量 */
  preview: () => void;
} {
  const [soundEnabled, setEnabled] = useState(readSoundEnabled);

  return {
    soundEnabled,
    setSoundEnabled: (next) => {
      writeSoundEnabled(next);
      setEnabled(next);
    },
    preview: playNoticeSound,
  };
}
