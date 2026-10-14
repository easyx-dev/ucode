/**
 * 插件域常量：清单上限、兼容键名单、命名保留名与组件默认路径。
 *
 * 只放不依赖状态的固定值；状态结构、默认市场与来源判定在 `harness/plugins/state.ts`。
 */
import {
  PLUGIN_AGENTS_DIRNAME,
  PLUGIN_BIN_DIRNAME,
  PLUGIN_COMMANDS_DIRNAME,
  PLUGIN_EXTENSIONS_DIRNAME,
  PLUGIN_HOOKS_FILENAME,
  PLUGIN_MCP_FILENAME,
  PLUGIN_SKILLS_DIRNAME,
} from "./dirs";

/** 单个清单文件的体积上限：清单是元数据，超过这个量级基本是误放的文件 */
export const PLUGIN_MANIFEST_MAX_BYTES = 256 * 1024;

/**
 * 识别但不执行的顶层键：Claude / ZCode 的扩展面。
 * 只出 info 诊断，键值原样保留在清单里，不影响其它组件装载。
 */
export const PLUGIN_IGNORED_MANIFEST_KEYS = [
  "settings",
  "channels",
  "lspServers",
  "outputStyles",
  "workflows",
  "experimental",
  "types",
] as const;

/** 跨插件依赖：要一整套版本求解与冲突优先序，本轮只诊断忽略 */
export const PLUGIN_IGNORED_DEPENDENCY_KEY = "dependencies";

/** 内置技能名：视为已占用的组件 token，插件同名时追加哈希后缀 */
export const PLUGIN_RESERVED_COMPONENT_TOKENS = [
  "plugin-create",
  "plugin-review",
  "skill-create",
  "agent-create",
  "command-create",
] as const;

/** 冲突后缀长度：够区分、肉眼仍可读 */
export const PLUGIN_TOKEN_HASH_LENGTH = 6;

/** token 前缀：sanitize 后为空或以数字开头时补上，保证 token 始终可用作标识 */
export const PLUGIN_TOKEN_PREFIX = "p";

/** 清单不声明时各组件组的默认路径；显式声明会替换（skills / extensions 是叠加） */
export const PLUGIN_COMPONENT_DEFAULT_PATHS = {
  skills: [`./${PLUGIN_SKILLS_DIRNAME}`],
  commands: [`./${PLUGIN_COMMANDS_DIRNAME}`],
  agents: [`./${PLUGIN_AGENTS_DIRNAME}`],
  extensions: [`./${PLUGIN_EXTENSIONS_DIRNAME}`],
} as const;

/** 固定路径的组件：hooks 与 MCP 的配置文件、bin 目录 */
export const PLUGIN_HOOKS_COMPONENT_PATH = `./${PLUGIN_HOOKS_FILENAME}`;
export const PLUGIN_MCP_COMPONENT_PATH = `./${PLUGIN_MCP_FILENAME}`;
export const PLUGIN_BIN_COMPONENT_PATH = `./${PLUGIN_BIN_DIRNAME}`;

/** 组件目录的递归深度上限：命令子目录会扁平化，但不该为病态目录结构无限挖下去 */
export const PLUGIN_COMPONENT_SCAN_MAX_DEPTH = 5;

/** 目录内容哈希的上限：超过就不算哈希（返回 null），避免把大仓库拖成慢查询 */
export const PLUGIN_HASH_MAX_FILES = 2000;
export const PLUGIN_HASH_MAX_BYTES = 8 * 1024 * 1024;
export const PLUGIN_HASH_MAX_DEPTH = 6;

/** 压缩体上限（url 来源）：超过即拒绝，半截包比失败更难排查 */
export const PLUGIN_PACKAGE_MAX_BYTES = 32 * 1024 * 1024;

/** 解包上限：解包后总量与条目数，防解压炸弹 */
export const PLUGIN_UNPACK_MAX_BYTES = 128 * 1024 * 1024;
export const PLUGIN_UNPACK_MAX_ENTRIES = 5000;

/** 出网超时：市场清单与插件包共用一个上限（小文件，慢就不等） */
export const PLUGIN_FETCH_TIMEOUT_MS = 60_000;

/** 市场清单体积上限 */
export const PLUGIN_MARKETPLACE_MAX_BYTES = 4 * 1024 * 1024;

/** git 克隆超时：源码包可能不小，但也不该无限等 */
export const PLUGIN_GIT_TIMEOUT_MS = 120_000;

/** 目录内容哈希跳过的目录：版本库与依赖不参与「插件内容变没变」的判断 */
export const PLUGIN_HASH_SKIP_DIRNAMES = [".git", "node_modules"] as const;

/** 旧版本副本的保留期：14 天（与 Claude Code 同）——够覆盖「会话还握着旧路径」的窗口 */
export const PLUGIN_ORPHAN_TTL_DAYS = 14;
