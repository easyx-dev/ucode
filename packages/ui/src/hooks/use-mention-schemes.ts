/**
 * 方言里算「引用锚点」的 scheme 表：来自插件贡献（`ui.mentions`）。
 *
 * 内核不认识任何一个具体 scheme——`@design:` 只是当前唯一注册的那个。没有插件宿主时是空表，
 * 于是所有 `@x:` 都按普通文本 / 文件引用处理（与「没装插件」的行为一致）。
 */
import { useMemo } from "react";

import { usePluginUi } from "../provider/plugin-host";

export const useMentionSchemes = (): readonly string[] => {
  const pluginUi = usePluginUi();
  return useMemo(
    () => (pluginUi?.plugins ?? []).flatMap((bundle) => bundle.mentions.map((item) => item.scheme)),
    [pluginUi],
  );
};
