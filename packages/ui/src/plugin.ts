/**
 * 插件界面的公开面：类型给插件作者（`@ucode/ui/plugin` → `@ucode/plugin-api`），
 * Provider 与两个界面落点给应用外壳。
 *
 * 插件作者只该用类型与 `@ucode/plugin-api` 的运行时导出，不该直接引 `@ucode/ui` 的内部模块——
 * 那会让插件与宿主的具体实现绑死，宿主一改实现插件就崩。
 */
export {
  installPluginHost,
  PLUGIN_HOST_GLOBAL,
  PLUGIN_UI_API_VERSION,
  type PluginUiActions,
  type PluginUiApi,
  type PluginUiComponent,
  type PluginUiComponentProps,
  type PluginUiHostInfo,
  type PluginUiPrimitives,
} from "./provider/plugin-api";
export {
  PluginDocSurface,
  type PluginUiHostValue,
  PluginUiProvider,
  PluginViewSurface,
  usePluginUi,
} from "./provider/plugin-host";
