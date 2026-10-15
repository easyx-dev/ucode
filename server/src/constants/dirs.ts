/** 固定目录名与文件名：运行时布局的唯一出处，由 `$APP_HOME` 派生 */
import { brand } from "@ucode/brand/values";

/** 运行时数据目录名（位于 APP_HOME 下）：auth.json / sessions */
export const HARNESS_DIRNAME = "harness";

/** 应用自有数据目录名（位于 APP_HOME 下）：config.json / SQLite */
export const APP_DIRNAME = "app";

/** 会话 JSONL 目录名（位于 pi 目录下） */
export const SESSIONS_DIRNAME = "sessions";

/** 会话工作区根目录名（位于主目录下）：`workspace/<sessionId>` */
export const WORKSPACE_DIRNAME = "workspace";

/** SQLite 数据库文件名（位于 app 目录下），与品牌无关，保持稳定 */
export const DB_FILENAME = "app.db";

export const CONFIG_FILENAME = "config.json";

/** 服务注册文件（位于 app 目录下）：host / port / 凭证，由服务独占写、客户端只读 */
export const SERVICE_FILENAME = "service.json";

/** pi 的 MCP 服务器配置（用户级），位于 agent 目录下，由本服务读写 */
export const MCP_CONFIG_FILENAME = "mcp.json";

/** pi 的鉴权文件 */
export const AUTH_FILENAME = "auth.json";

/** 自定义角色目录名：全局 `$APP_HOME/agents/*.md`、项目配置目录 `agents/*.md` */
export const AGENTS_DIRNAME = "agents";

/** 全局技能目录名（位于 APP_HOME 下）：`skills/<id>/SKILL.md` */
export const SKILLS_DIRNAME = "skills";

/** 全局命令（提示词模板）目录名（位于 APP_HOME 下）：`prompts/<name>.md` */
export const PROMPTS_DIRNAME = "prompts";

/** 项目级配置目录名（位于会话 cwd 及其祖先）：品牌 slug 加前导点，如 `.<slug>` */
export const PROJECT_CONFIG_DIRNAME = `.${brand.slug}`;

/** 兼容生态的技能目录名（项目祖先或用户主目录下）：`.agents` */
export const AGENTS_COMPAT_DIRNAME = ".agents";

/** 附件库目录名（位于 `$APP_HOME/app` 下），按内容 sha256 寻址 */
export const ATTACHMENTS_DIRNAME = "attachments";

/** 项目记忆根目录名（位于 `$APP_HOME/app` 下）：`memory/projects/<project>` */
export const MEMORY_DIRNAME = "memory";

/** 记忆项目目录名（位于记忆根目录下） */
export const MEMORY_PROJECTS_DIRNAME = "projects";

/** 记忆索引文件名：一行一条，指向同目录下的事实文件 */
export const MEMORY_INDEX_FILENAME = "MEMORY.md";

/** 插件根目录名（位于 APP_HOME 下）：`cache/` `marketplaces/` `data/` 三个子目录 */
export const PLUGINS_DIRNAME = "plugins";

/** 插件安装副本目录名（位于插件根下）：`cache/<market>/<plugin>/<version>` */
export const PLUGIN_CACHE_DIRNAME = "cache";

/** 市场清单缓存目录名（位于插件根下）：`marketplaces/<market>/marketplace.json` */
export const PLUGIN_MARKETPLACES_DIRNAME = "marketplaces";

/** 插件持久数据目录名（位于插件根下）：`data/<sanitized-plugin-id>`，即 `${*_PLUGIN_DATA}` */
export const PLUGIN_DATA_DIRNAME = "data";

/**
 * 旧版本副本的处理：换版本 / 同版本重拉时旧副本先改名成 `<前缀><版本>-<时间戳>`，
 * 并在里面写 `<标记文件>`（内容是 ISO 时间），14 天后由清扫删掉。
 * 不立即删是因为可能有会话正握着旧路径跑（`${*_PLUGIN_ROOT}` 指向版本目录）。
 */
export const PLUGIN_ORPHAN_DIRNAME_PREFIX = ".orphaned-";
export const PLUGIN_ORPHAN_MARKER_FILENAME = ".orphaned_at";

/** 插件状态文件名（位于 app 目录下）：登记表 + 用户配置 + 注册表代次 */
export const PLUGIN_STATE_FILENAME = "plugins.json";

/**
 * 项目级启停覆盖的文件名，位于 `<cwd>/.<slug>/`：
 * `plugins.json` 提交进仓库给团队共用，`plugins.local.json` 是个人覆盖（建议 gitignore）。
 */
export const PLUGIN_PROJECT_OVERRIDES_FILENAME = "plugins.json";
export const PLUGIN_PROJECT_OVERRIDES_LOCAL_FILENAME = "plugins.local.json";

/** 市场清单文件名（位于市场目录 / 直链末尾） */
export const PLUGIN_MARKETPLACE_FILENAME = "marketplace.json";

/** 内置资产物化目录名（位于 app 目录下）：`skills/` 与 `manifest.json` */
export const BUILTIN_DIRNAME = "builtin";

/** 浏览器数据目录名（位于 app 目录下）：`profiles/<name>` 是各份持久化 profile */
export const BROWSER_DIRNAME = "browser";

/** 浏览器 profile 目录名（位于浏览器数据目录下） */
export const BROWSER_PROFILES_DIRNAME = "profiles";

/** 本品牌清单目录名（位于插件包内）：`.<slug>-plugin` */
export const PLUGIN_MANIFEST_DIRNAME = `.${brand.slug}-plugin`;

/** 兼容生态的清单目录名（位于插件包内），按识别顺序排在本品牌之后 */
export const PLUGIN_COMPAT_MANIFEST_DIRNAMES = [".zcode-plugin", ".claude-plugin"] as const;

/** 清单文件名（位于上面任一个清单目录内） */
export const PLUGIN_MANIFEST_FILENAME = "plugin.json";

/** 插件包内各组件的默认目录名：只在清单没显式声明时使用 */
export const PLUGIN_SKILLS_DIRNAME = "skills";
export const PLUGIN_COMMANDS_DIRNAME = "commands";
export const PLUGIN_AGENTS_DIRNAME = "agents";
export const PLUGIN_EXTENSIONS_DIRNAME = "extensions";
export const PLUGIN_BIN_DIRNAME = "bin";

/** 命令式 hook 的配置文件名（位于插件包内），与清单 `hooks` 键合并 */
export const PLUGIN_HOOKS_FILENAME = "hooks/hooks.json";

/** MCP 服务器配置文件名（位于插件包内），与清单 `mcpServers` 键合并 */
export const PLUGIN_MCP_FILENAME = ".mcp.json";

/** 技能真身文件名 */
export const SKILL_FILENAME = "SKILL.md";

/** Markdown 扩展名：命令 / 角色组件的文件后缀 */
export const MARKDOWN_EXTENSION = ".md";
