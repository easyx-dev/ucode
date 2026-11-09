/**
 * 插件作者的运行时入口（只有类型与声明，没有实现）。
 *
 * 插件模块里写 `import { ui, actions } from "@ucode/plugin-api"` 时，构建产物把这条 import 保留为
 * 裸 specifier（external），由**服务端托管时改写成宿主运行时 shim 的地址**——所以这个包在运行期
 * 一个字节都不会被打进插件。这里声明的是那份 shim 的导出形状，与
 * `server/src/harness/plugins/ui-runtime.ts` 里的 `PLUGIN_API_SHIM` 一一对应（改一处要改两处）。
 *
 * 现状：插件仓的界面源码只做构建、不做类型检查——它经 `tsconfig` 指不回这里的实现（跨仓 install
 * 会带进第二份 React 类型，整棵类型树都会打架）。等 `@ucode/plugin-api` 发到 npm，插件仓引它，
 * 类型就有了单一来源；在那之前，作者侧的编译期保障靠宿主这一侧的 `satisfies`（见
 * `packages/ui/src/provider/plugin-host.tsx`）。
 */
import type {
  PluginUiActions,
  PluginUiApi,
  PluginUiComponent,
  PluginUiComponentProps,
  PluginUiHostInfo,
  PluginUiPrimitives,
} from "@ucode/ui/plugin";

export type {
  PluginUiActions,
  PluginUiApi,
  PluginUiComponent,
  PluginUiComponentProps,
  PluginUiHostInfo,
  PluginUiPrimitives,
};

/** 宿主实现的运行时版本：与清单 `ui.apiVersion` 比对 */
export declare const version: number;
/** 宿主那一份 React（插件不自带 React，否则 hooks 会报 Invalid hook call） */
export declare const react: PluginUiApi["react"];
export declare const ui: PluginUiPrimitives;
export declare const hooks: PluginUiApi["hooks"];
export declare const actions: PluginUiActions;
export declare const http: PluginUiApi["http"];
export declare const events: PluginUiApi["events"];
export declare const i18n: PluginUiApi["i18n"];
/** 整份宿主运行时；`default` 与之同一个对象 */
export declare const host: PluginUiApi;
export default host;
