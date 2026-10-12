/**
 * 插件宿主的视图模型：注册表构建产物。
 *
 * 安装来源与状态结构在 `state.ts`（那一份带 zod schema，类型由它派生）；
 * 这里只放不需要校验的派生结构。
 */
import type { PluginComponentGroup, PluginDiagnosticView, PluginSource } from "@ucode/contracts";

/** 清单解析出的一个组件：路径已归一化，且校验过落在插件根内 */
export type PluginComponentEntry = {
  group: PluginComponentGroup;
  /** 组件名：技能 / 命令 / 角色的目录名或文件名（不含扩展名） */
  name: string;
  /** 目录或文件的绝对路径；清单内联定义（命令内容、hooks、mcpServers）为 null */
  path: string | null;
};

/** 注册表里的一个插件：登记信息 + 清单装载结果 + 来源门控结论 */
export type PluginDescriptor = {
  id: string;
  name: string;
  displayName: string;
  description: string;
  version: string;
  /** 信任档位，由来源决定（见 `plans/plugins.md` 第五章） */
  source: PluginSource;
  enabled: boolean;
  /** 安装目录绝对路径 */
  root: string;
  installedAt: string;
  /** 解析出的组件；未启用也照样解析，供设置页展示与排查 */
  components: PluginComponentEntry[];
  /** 因来源为第三方市场而不注入运行时的执行类组件分组 */
  blocked: PluginComponentGroup[];
  diagnostics: PluginDiagnosticView[];
};

/** 一次注册表构建的结果；变更后重建，不做模块级缓存 */
export type PluginRegistry = {
  revision: number;
  plugins: PluginDescriptor[];
  /** 登记表本身的问题（重复 id、来源不可用等），与单个插件的诊断分开 */
  diagnostics: PluginDiagnosticView[];
};
