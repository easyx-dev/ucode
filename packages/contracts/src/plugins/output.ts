/** plugins 域的响应模型：已登记插件的视图、组件摘要与诊断 */
import type {
  PluginComponentGroup,
  PluginDiagnosticLevel,
  PluginSource,
  PluginSwitchLayer,
} from "./constants";

/**
 * 一条诊断：坏清单、越界组件路径、未注入的执行类组件都走它。
 * 诊断只影响所属组件，不阻断其它插件——运行时数据坏了就跳过并报告，与自定义角色同一口径。
 */
export type PluginDiagnosticView = {
  level: PluginDiagnosticLevel;
  /** 归属组件；清单本身的问题记 `manifest` */
  component: PluginComponentGroup;
  /** 面向用户的中文说明；服务端不本地化，与失败封套同一口径 */
  message: string;
};

/** 各组件组的数量：列表页用它显示「3 个技能 / 1 个 MCP」 */
export type PluginComponentCounts = {
  skills: number;
  commands: number;
  agents: number;
  hooks: number;
  mcp: number;
  bin: number;
  extensions: number;
};

/** 插件声明的 userConfig 项：宿主按它渲染配置表单，类型由清单给出 */
export type PluginUserConfigFieldView = {
  key: string;
  /** 控件类型：string | number | boolean | directory | file | select */
  type: string;
  title: string;
  description: string;
  required: boolean;
  /** 缺省值；类型随 `type` */
  default?: string | number | boolean;
  /** `select` 的候选值 */
  options?: string[];
  /** 允许多选（`select`） */
  multiple?: boolean;
  /** 敏感值：不回显（服务端只回传是否已设置） */
  sensitive?: boolean;
};

/** 组件清单里的一项：详情页按组分节展开 */
export type PluginComponentRefView = {
  group: PluginComponentGroup;
  name: string;
};

export type PluginView = {
  /** 身份 `<name>@<marketplace>`；直接登记的本地目录用 `<name>@local` */
  id: string;
  /** 清单里的 name，缺省取安装目录名 */
  name: string;
  /** 界面显示名，缺省与 `name` 相同 */
  displayName: string;
  description: string;
  version: string;
  /** 信任档位：执行类组件是否注入按它判定 */
  source: PluginSource;
  /** 生效的启用状态：项目 / 本地覆盖优先于用户登记表里的值 */
  enabled: boolean;
  /** `enabled` 由哪一层决定；界面据此提示「这个仓库里被设成了 X」 */
  enabledBy: PluginSwitchLayer;
  /** 安装目录绝对路径（`${*_PLUGIN_ROOT}` 指向它） */
  path: string;
  /** 安装时间（ISO 8601） */
  installedAt: string;
  components: PluginComponentCounts;
  /** 组件逐个列出：列表只给计数，详情页要名字 */
  componentRefs: PluginComponentRefView[];
  /** userConfig 的声明；没有配置项时为空数组 */
  userConfig: PluginUserConfigFieldView[];
  /** userConfig 的已存值；敏感项不在其中（只体现 `configured` 语义） */
  config: Record<string, string | number | boolean>;
  /** 按来源判定为「不注入运行时」的组件分组：界面据此直说为什么 hook 不跑 */
  blockedComponents: PluginComponentGroup[];
  /**
   * 来源内容是否已变（目录来源按内容哈希、git 按 ls-remote 的 commit、npm 按 registry 版本、
   * url 按条件请求判定）。由「刷新市场」这类显式动作重算，列表接口本身不打网络、不扫盘，
   * 只回显上次结论。
   */
  updateAvailable: boolean;
  /** 远端最新版本：只有能判定出版本号的来源（npm / 清单声明）才有 */
  latestVersion?: string;
  /** 上次检查更新的时间（ISO 8601）；从没检查过则缺省 */
  checkedAt?: string;
  diagnostics: PluginDiagnosticView[];
};

/** 项目级覆盖的来源与读盘诊断（请求带 cwd 时才有） */
export type PluginOverridesView = {
  /** `<cwd>/.<slug>/plugins.json`：提交进仓库的那份 */
  projectPath: string;
  /** `<cwd>/.<slug>/plugins.local.json`：个人覆盖（建议 gitignore） */
  localPath: string;
  diagnostics: string[];
};

export type PluginsListResponse = {
  plugins: PluginView[];
  /** 状态文件绝对路径，供设置页展示与排查 */
  statePath: string;
  /** 注册表代次：变更入口推进它，会话按它决定是否重建 */
  revision: number;
  /** 项目级覆盖的来源与诊断；请求没带 `cwd` 时为 null */
  overrides: PluginOverridesView | null;
};

/** 安装 / 启停 / 重拉的统一回执：变更后的插件视图与新的代次 */
export type PluginWriteResponse = {
  plugin: PluginView;
  revision: number;
  /** 契约视图之外的登记信息不回显；客户端刷新列表即可拿到其它插件 */
};

export type PluginDeleteResponse = {
  /** 是否命中并移除了登记；目标不存在时报错，故恒为 true */
  removed: boolean;
  /** 是否连磁盘内容一并清理（`purge`）；本地目录来源的内容不会被删 */
  purged: boolean;
  revision: number;
};
